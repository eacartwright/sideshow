import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newId, OP_TYPES, type OpEnvelope } from "@sideshow/shared";
import { startBackups } from "./backup";
import { openDb } from "./db";
import { FileStore, MAX_FILE } from "./files";
import { ConnectWiseClient, CwError, configFromEnv } from "./integrations/connectwise/client";
import { CompanyCache } from "./integrations/connectwise/companies";
import { CwDocuments } from "./integrations/connectwise/documents";
import { WeeklyTickets } from "./integrations/connectwise/weekly";
import { checkPushed, pushSessions } from "./integrations/connectwise/push";
import { TicketMaker, type NewTicket } from "./integrations/connectwise/tickets";
import { defaultsBackfill, loadProfile, profileListChanges } from "./profile";
import { Store } from "./store";

const PORT = Number(process.env.PORT ?? 8787);
// The app was called fieldtime until 2026-10: FIELDTIME_* settings still work.
const setting = (name: string) => process.env[`SIDESHOW_${name}`] ?? process.env[`FIELDTIME_${name}`];
const DB_FILE = setting("DB") ?? defaultDbFile();
const BACKUP_DIR = setting("BACKUP_DIR") ?? join(dirname(DB_FILE), "backups");
const FILES_DIR = setting("FILES_DIR") ?? join(dirname(DB_FILE), "files");

/** data/sideshow.db, renaming data/fieldtime.db (and its WAL files) to it the first time. */
function defaultDbFile(): string {
  const file = fileURLToPath(new URL("../../../data/sideshow.db", import.meta.url));
  const old = fileURLToPath(new URL("../../../data/fieldtime.db", import.meta.url));
  if (!existsSync(file) && existsSync(old)) {
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(old + suffix)) renameSync(old + suffix, file + suffix);
    console.log(`renamed ${old} to ${file}`);
  }
  return file;
}
const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));

// Load the profile first: a broken profile file should stop the server before anything changes.
const profile = loadProfile(process.env.PROFILE);
console.log(process.env.PROFILE ? `profile: ${profile.name}` : "profile: none (set PROFILE in .env for job fields)");
const db = openDb(DB_FILE);
const store = new Store(db);
const files = new FileStore(db, FILES_DIR);
const backups = startBackups(db, BACKUP_DIR, FILES_DIR);
const now = Date.now();
const listChanges = profileListChanges(profile, store.state, now);
if (listChanges.length) {
  // New or changed defaults (a work type's billing) also fill records that have none yet.
  const { tasks, sessions } = defaultsBackfill(store.state, listChanges, now);
  store.seed({ lists: listChanges, projects: [], tasks, sessions });
  console.log(`profile lists: ${listChanges.length} items updated, defaults filled on ${tasks.length + sessions.length} records`);
}

// ConnectWise is optional: without the CW_* settings in .env, ticket lookup is off.
const cw = (() => {
  if (!process.env.CW_SITE) return null;
  try {
    return new ConnectWiseClient(configFromEnv());
  } catch (err) {
    console.error(`ConnectWise is off: ${(err as Error).message}`);
    return null;
  }
})();
// The company picker's copy of CW's companies: brought up to date at startup and every few hours.
const companies = cw && profile.connectwise ? new CompanyCache(db, cw) : null;
if (companies) {
  void companies.sync();
  setInterval(() => void companies.sync(), 4 * 3_600_000).unref();
}
// Pushing time entries also needs whose time it is (a CW member identifier, e.g. ecartwright).
const CW_MEMBER = process.env.CW_MEMBER?.trim() || null;
if (cw && profile.connectwise && !CW_MEMBER) console.log("ConnectWise push is off: set CW_MEMBER in .env");
// A note's attachments go to the ticket its time is pushed to (once per ticket).
const documents = cw ? new CwDocuments(db, files, cw) : undefined;
const tickets = cw && profile.connectwise ? new TicketMaker(cw, store, profile, CW_MEMBER, documents) : null;
// The weekly recurring internal ticket (WRIT): found by its summary and owner, looked for again
// once a week (DESIGN.md §10). CW_WEEKLY_SUMMARY overrides the summary looked for.
const weekly =
  cw && profile.connectwise && CW_MEMBER && tickets
    ? new WeeklyTickets(db, cw, CW_MEMBER, async () => {
        if (process.env.CW_WEEKLY_SUMMARY) return process.env.CW_WEEKLY_SUMMARY;
        const owner = await tickets.getOwner().catch(() => null);
        return owner ? `Weekly Recurring Internal Ticket - ${owner.name}` : null;
      })
    : null;
if (weekly) {
  weekly.checkIfDue();
  setInterval(() => weekly.checkIfDue(), 15 * 60_000).unref();
}
/**
 * A ticket's page in CW, with {id} for the number: the form of CW's own "Share" link, on the API
 * host without its "api-" prefix (api-na.myconnectwise.net → na.myconnectwise.net). Signed out,
 * CW sends it through its login and back. CW_TICKET_URL overrides.
 */
const CW_TICKET_URL = !cw
  ? null
  : (process.env.CW_TICKET_URL ??
    `https://${process.env.CW_SITE!.replace(/^api-/, "")}/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid={id}&companyName=${encodeURIComponent(process.env.CW_COMPANY_ID ?? "")}`);

function isOpEnvelope(x: any): x is OpEnvelope {
  return (
    x && typeof x.id === "string" && typeof x.at === "number" && x.op && OP_TYPES.has(x.op.type)
  );
}

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true, rev: store.rev, lastBackup: backups.latest() }));

app.get("/api/state", (c) =>
  c.json({
    rev: store.rev,
    state: store.state,
    config: {
      profile,
      cw: cw !== null && !!profile.connectwise,
      cwPush: cw !== null && !!profile.connectwise && !!CW_MEMBER,
      cwWeekly: weekly !== null,
      cwTicketUrl: profile.connectwise ? CW_TICKET_URL : null,
    },
  }),
);

app.get("/api/cw/tickets/:id", async (c) => {
  if (!cw) return c.json({ error: "ConnectWise isn't set up on this server" }, 503);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Not a ticket number" }, 400);
  try {
    const t = await cw.getTicket(id);
    return c.json({ id: t.id, summary: t.summary, company: t.company?.name ?? "", companyId: t.company?.id ?? null, closed: !!t.closedFlag });
  } catch (err) {
    if (err instanceof CwError && err.status === 404) return c.json({ error: `No ticket #${id}` }, 404);
    console.error(err);
    return c.json({ error: "ConnectWise lookup failed" }, 502);
  }
});

// Every CW company, duplicates marked, for the company picker. The client keeps a copy.
app.get("/api/cw/companies", (c) => {
  if (!companies) return c.json({ error: "ConnectWise isn't set up on this server" }, 503);
  return c.json({ ...companies.status(), companies: companies.list() });
});

// Sync now (and answer once it's done). ?full=1 asks every company for its newest ticket again.
app.post("/api/cw/companies/refresh", async (c) => {
  if (!companies) return c.json({ error: "ConnectWise isn't set up on this server" }, 503);
  await companies.sync(c.req.query("full") === "1");
  return c.json({ ...companies.status(), companies: companies.list() });
});

// This week's recurring internal ticket, for ▶ WRIT. Asking also looks again if it's due.
app.get("/api/cw/weekly", (c) => {
  if (!weekly) return c.json({ error: "ConnectWise push isn't set up on this server" }, 503);
  weekly.checkIfDue();
  return c.json({ weekly: weekly.current() });
});
app.post("/api/cw/weekly/refresh", async (c) => {
  if (!weekly) return c.json({ error: "ConnectWise push isn't set up on this server" }, 503);
  return c.json({ weekly: await weekly.check() });
});

// Rename a ticket: its summary in CW becomes the task's title (Task details' "Update ticket").
// The new summary is recorded on the task like a lookup's, so every device sees it.
app.post("/api/cw/tickets/:id/summary", async (c) => {
  if (!cw || !profile.connectwise) return c.json({ error: "ConnectWise isn't set up on this server" }, 503);
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => null);
  const summary = typeof b?.summary === "string" ? b.summary.trim() : "";
  const task = typeof b?.taskId === "string" ? store.state.tasks[b.taskId] : undefined;
  if (!Number.isInteger(id) || id <= 0 || !summary || !task) return c.json({ error: "taskId, summary and a ticket number needed" }, 400);
  if (summary.length > 100) return c.json({ error: "ConnectWise allows 100 characters in a summary" }, 400);
  try {
    const t = await cw.updateTicketSummary(id, summary);
    const field = profile.connectwise.ticketField;
    const at = Date.now();
    store.apply([
      {
        id: newId(),
        at,
        op: {
          type: "task.refInfo",
          taskId: task.id,
          field,
          ref: String(id),
          info: {
            summary: t.summary ?? summary,
            company: t.company?.name ?? task.refInfo?.company ?? "",
            ...(t.company?.id ? { companyId: t.company.id } : {}),
            closed: !!t.closedFlag,
            fetchedAt: at,
          },
        },
      },
    ]);
    return c.json({ summary: t.summary ?? summary });
  } catch (err) {
    console.error(err);
    if (err instanceof CwError && err.status === 404) return c.json({ error: `No ticket #${id}` }, 404);
    return c.json({ error: "Couldn't update the ticket in ConnectWise" }, 502);
  }
});

// What a new ticket can be: boards with their types and statuses, and who it's assigned to.
app.get("/api/cw/boards", async (c) => {
  if (!tickets) return c.json({ error: "ConnectWise isn't set up on this server" }, 503);
  try {
    const [boards, owner] = await Promise.all([tickets.getBoards(), tickets.getOwner().catch(() => null)]);
    return c.json({ boards, owner });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Couldn't reach ConnectWise" }, 502);
  }
});

// Create a CW ticket for a task; its number goes onto the task (an op every device sees).
app.post("/api/cw/tickets", async (c) => {
  if (!tickets) return c.json({ error: "ConnectWise isn't set up on this server" }, 503);
  const b = await c.req.json().catch(() => null);
  const num = (x: unknown) => (typeof x === "number" && Number.isInteger(x) && x > 0 ? x : undefined);
  if (!b || typeof b.taskId !== "string" || typeof b.summary !== "string" || !num(b.boardId)) {
    return c.json({ error: "taskId, summary and boardId needed" }, 400);
  }
  const req: NewTicket = {
    taskId: b.taskId,
    summary: b.summary,
    boardId: num(b.boardId)!,
    typeId: num(b.typeId),
    statusId: num(b.statusId),
    assign: b.assign !== false,
    description: typeof b.description === "string" ? b.description : undefined,
    pushSessionIds: Array.isArray(b.pushSessionIds) ? b.pushSessionIds.filter((x: unknown) => typeof x === "string") : undefined,
  };
  try {
    const result = await tickets.create(req);
    return c.json(result, "error" in result ? 409 : 200);
  } catch (err) {
    console.error(err);
    // CW's message says what it didn't like (a required field, a closed board…).
    let detail: string | undefined;
    try {
      detail = err instanceof CwError ? JSON.parse(err.body)?.message : undefined;
    } catch {
      // Not JSON: the generic message will do.
    }
    return c.json({ error: detail ? `ConnectWise: ${detail}` : "Couldn't reach ConnectWise. No ticket was made." }, 502);
  }
});

// Push sessions to CW as time entries. The client sends its queued ops first, so the server's
// state is what the user sees. Results come back per session; successes are also recorded on
// the sessions (an op, so every device sees them).
app.post("/api/cw/push", async (c) => {
  if (!cw || !profile.connectwise || !CW_MEMBER) return c.json({ error: "ConnectWise push isn't set up on this server" }, 503);
  const body = await c.req.json().catch(() => null);
  const ids: unknown[] = Array.isArray(body?.sessionIds) ? body.sessionIds : [];
  if (!ids.length || ids.some((x) => typeof x !== "string")) return c.json({ error: "sessionIds needed" }, 400);
  try {
    const results = await pushSessions(cw, store, profile, CW_MEMBER, ids as string[], documents);
    return c.json({ results });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Couldn't reach ConnectWise" }, 502);
  }
});

// Which pushed sessions' CW entries have been deleted in CW; those go back to To enter.
app.post("/api/cw/check", async (c) => {
  if (!cw || !profile.connectwise) return c.json({ error: "ConnectWise isn't set up on this server" }, 503);
  const body = await c.req.json().catch(() => null);
  const ids: unknown[] = Array.isArray(body?.sessionIds) ? body.sessionIds : [];
  if (ids.some((x) => typeof x !== "string")) return c.json({ error: "sessionIds needed" }, 400);
  try {
    return c.json({ removed: await checkPushed(cw, store, ids as string[]) });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Couldn't reach ConnectWise" }, 502);
  }
});

// Attachments. Upload: the raw bytes as the body, the type as Content-Type, the name in
// X-File-Name (URL-encoded). Answers with where notes link to it.
app.post("/api/files", async (c) => {
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > MAX_FILE) return c.json({ error: `Files can be up to ${MAX_FILE / 1024 / 1024} MB` }, 413);
  const data = new Uint8Array(await c.req.arrayBuffer());
  if (!data.byteLength) return c.json({ error: "Empty file" }, 400);
  if (data.byteLength > MAX_FILE) return c.json({ error: `Files can be up to ${MAX_FILE / 1024 / 1024} MB` }, 413);
  let name = "file";
  try {
    name = decodeURIComponent(c.req.header("x-file-name") ?? "file");
  } catch {
    // Not URL-encoded: keep "file".
  }
  const info = files.save(data, name, c.req.header("content-type") ?? "");
  return c.json({ ...info, url: FileStore.url(info) });
});

// A file, by id; the name after it is for people and is ignored. Never changes, so cached for good.
app.get("/api/files/:id/:name?", (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/.test(id)) return c.json({ error: "No such file" }, 404);
  const file = files.read(id);
  if (!file) return c.json({ error: "No such file" }, 404);
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(file.info.type);
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": file.info.type,
      "content-length": String(file.info.size),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.info.name)}`,
    },
  });
});

app.post("/api/ops", async (c) => {
  const body = await c.req.json().catch(() => null);
  const ops: unknown[] = Array.isArray(body?.ops) ? body.ops : [];
  const valid = ops.filter(isOpEnvelope);
  if (valid.length !== ops.length) return c.json({ error: "invalid op" }, 400);
  const changes = store.apply(valid);
  return c.json({ rev: store.rev, changes });
});

// Live updates: every change is pushed to every connected device.
app.get("/api/events", (c) =>
  streamSSE(c, async (stream) => {
    const off = store.onChange((rev, changes) => {
      void stream.writeSSE({ event: "changes", data: JSON.stringify({ rev, changes }) });
    });
    await stream.writeSSE({ event: "hello", data: JSON.stringify({ rev: store.rev }) });
    const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }), 25_000);
    await new Promise<void>((resolve) => stream.onAbort(resolve));
    clearInterval(ping);
    off();
  }),
);

// In production the server also serves the built web app.
if (existsSync(WEB_DIST)) {
  // Built assets have hashed names and never change. Everything else (index.html,
  // the manifest) must be revalidated, or the iPhone PWA keeps running an old build.
  app.use("/*", async (c, next) => {
    await next();
    c.header("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  });
  app.use("/*", serveStatic({ root: WEB_DIST }));
  app.get("*", serveStatic({ path: `${WEB_DIST}/index.html` }));
}

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`sideshow server on http://localhost:${info.port}  (db: ${DB_FILE}, files: ${FILES_DIR}, backups: ${BACKUP_DIR})`);
});
