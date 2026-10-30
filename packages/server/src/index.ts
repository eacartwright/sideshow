import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newId, OP_TYPES, type OpEnvelope } from "@sideshow/shared";
import { FileStore, MAX_FILE } from "./files";
import { ConnectWiseClient, CwError } from "./integrations/connectwise/client";
import { ENV_KEYS, resolve, settingsFromEnv, shown, testConnection, type CwSettings } from "./integrations/connectwise/connection";
import { Ai, AiStopped, MAX_NOTES, parseAiSettings, providersFromEnv } from "./ai";
import { DevNotes, devNotesFile, parseFiles, parsePage, TEXT_MAX as DEV_NOTE_MAX } from "./devnotes";
import { updateEnvFile } from "./envfile";
import { parseRule } from "./integrations/connectwise/holds";
import { checkPushed, pushSessions } from "./integrations/connectwise/push";
import type { NewTicket } from "./integrations/connectwise/tickets";
import { listProfiles } from "./profile";
import { MAIN, Workspaces, type Workspace, type WorkspaceContext } from "./workspaces";

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

// The server's .env, where Settings › Connections saves the ConnectWise settings.
const ENV_FILE = setting("ENV_FILE") ?? fileURLToPath(new URL("../../../.env", import.meta.url));

// ConnectWise is optional: without the CW_* settings, ticket lookup is off. A workspace uses it
// when its profile has a connectwise section. Settings › Connections can change it while the
// server runs (useCw).
let cwSettings = settingsFromEnv(process.env);
function cwClient(s: CwSettings): ConnectWiseClient | null {
  if (!s.site) return null;
  const missing = (["companyId", "clientId", "publicKey", "privateKey"] as const).filter((k) => !s[k]).map((k) => ENV_KEYS[k]);
  if (missing.length) {
    console.error(`ConnectWise is off: missing ${missing.join(", ")}`);
    return null;
  }
  return new ConnectWiseClient({ ...s, baseUrl: process.env.CW_BASE_URL || undefined });
}

// Every workspace (workspaces.ts). Opening one loads its profile first: a broken profile file
// stops the server before anything changes.
const ctx: WorkspaceContext = {
  dataDir: dirname(DB_FILE),
  mainDbFile: DB_FILE,
  backupDir: BACKUP_DIR,
  filesDir: FILES_DIR,
  envProfile: process.env.PROFILE,
  cw: cwClient(cwSettings),
  // Pushing time entries also needs whose time it is (a CW member identifier, e.g. ecartwright).
  cwMember: cwSettings.member || null,
  cwWeeklySummary: process.env.CW_WEEKLY_SUMMARY,
};
const workspaces = new Workspaces(ctx);
for (const ws of workspaces.all()) {
  const file = ws.profileFile();
  console.log(`workspace ${ws.id} (${ws.entry.name}): ${file ? `profile ${ws.profile.name}` : "no profile"}`);
}
if (!process.env.PROFILE && !workspaces.main.entry.profile) console.log("(set PROFILE in .env for job fields)");
if (ctx.cw && !ctx.cwMember && workspaces.all().some((w) => w.profile.connectwise)) console.log("ConnectWise push is off: set CW_MEMBER");

/** New ConnectWise settings (saved in .env already): every workspace starts using them. */
function useCw(s: CwSettings) {
  cwSettings = s;
  for (const [k, name] of Object.entries(ENV_KEYS)) process.env[name] = s[k as keyof CwSettings];
  ctx.cw = cwClient(s);
  ctx.cwMember = s.member || null;
  for (const ws of workspaces.all()) {
    ws.restartCw();
    ws.notifyConfig();
  }
  console.log(ctx.cw ? `ConnectWise: now ${s.site} as ${s.member || "(no member: push off)"}` : "ConnectWise: off");
}

/**
 * A ticket's page in CW, with {id} for the number: the form of CW's own "Share" link, on the API
 * host without its "api-" prefix (api-na.myconnectwise.net → na.myconnectwise.net). Signed out,
 * CW sends it through its login and back. CW_TICKET_URL overrides.
 */
const ticketUrl = () =>
  !ctx.cw
    ? null
    : (process.env.CW_TICKET_URL ??
      `https://${cwSettings.site.replace(/^api-/, "")}/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid={id}&companyName=${encodeURIComponent(cwSettings.companyId)}`);

function isOpEnvelope(x: any): x is OpEnvelope {
  return (
    x && typeof x.id === "string" && typeof x.at === "number" && x.op && OP_TYPES.has(x.op.type)
  );
}

const app = new Hono<{ Variables: { ws: Workspace } }>();

app.get("/api/health", (c) => c.json({ ok: true, rev: workspaces.main.store.rev, lastBackup: workspaces.main.backups.latest() }));

// The workspaces, the profiles there are, and making, renaming or re-profiling one (Settings).
// Not tied to the workspace the request comes from.
app.get("/api/workspaces", (c) =>
  c.json({
    workspaces: workspaces.all().map((w) => ({ id: w.id, name: w.entry.name, profile: w.profileFile(), profileName: w.profile.name })),
    profiles: listProfiles(),
  }),
);
app.post("/api/workspaces", async (c) => {
  const b = await c.req.json().catch(() => null);
  const name = typeof b?.name === "string" ? b.name.trim() : "";
  const profile = typeof b?.profile === "string" ? b.profile : "";
  if (!name || name.length > 60) return c.json({ error: "A name (up to 60 characters) is needed" }, 400);
  try {
    const ws = workspaces.create(name, profile);
    return c.json({ id: ws.id });
  } catch (err) {
    console.error(err);
    return c.json({ error: `Couldn't use that profile: ${(err as Error).message}` }, 400);
  }
});
app.post("/api/workspaces/:id", async (c) => {
  const id = c.req.param("id");
  if (!workspaces.get(id)) return c.json({ error: "No such workspace" }, 404);
  const b = await c.req.json().catch(() => null);
  if (typeof b?.name === "string") {
    const name = b.name.trim();
    if (!name || name.length > 60) return c.json({ error: "A name (up to 60 characters) is needed" }, 400);
    workspaces.rename(id, name);
  }
  if (typeof b?.profile === "string") {
    try {
      const backup = workspaces.setProfile(id, b.profile);
      console.log(`workspace ${id}: profile now ${b.profile || "none"} (copy from before: ${backup})`);
    } catch (err) {
      console.error(err);
      return c.json({ error: `Couldn't use that profile: ${(err as Error).message}` }, 400);
    }
  }
  return c.json({ ok: true });
});

// Settings › Connections: the ConnectWise settings in the server's .env (connection.ts). Not per
// workspace. Changes are taken only from the app itself: a JSON body (which a page on another
// site can't send without the browser asking first) and, where the browser says, the same site.
const fromApp = (c: Context) => {
  const site = c.req.header("sec-fetch-site");
  return (c.req.header("content-type") ?? "").startsWith("application/json") && (!site || site === "same-origin");
};
app.get("/api/connections", (c) => c.json({ cw: { ...shown(cwSettings), on: !!ctx.cw } }));
app.post("/api/connections/cw/test", async (c) => {
  if (!fromApp(c)) return c.json({ error: "Not from the app" }, 403);
  const r = resolve(await c.req.json().catch(() => null), cwSettings);
  if ("error" in r) return c.json({ ok: false, error: r.error });
  if (!r.settings.site) return c.json({ ok: false, error: "No site: ConnectWise would be off" });
  return c.json(await testConnection(r.settings, process.env.CW_BASE_URL || undefined));
});
app.post("/api/connections/cw", async (c) => {
  if (!fromApp(c)) return c.json({ error: "Not from the app" }, 403);
  const r = resolve(await c.req.json().catch(() => null), cwSettings);
  if ("error" in r) return c.json({ error: r.error }, 400);
  const s = r.settings;
  // Only settings that work are saved (an empty site turns ConnectWise off).
  if (s.site) {
    const test = await testConnection(s, process.env.CW_BASE_URL || undefined);
    if (!test.ok) return c.json({ error: test.error }, 400);
  }
  try {
    updateEnvFile(ENV_FILE, Object.fromEntries(Object.entries(ENV_KEYS).map(([k, name]) => [name, s[k as keyof CwSettings]])));
  } catch (err) {
    console.error(err);
    return c.json({ error: `Couldn't save ${ENV_FILE}` }, 500);
  }
  useCw(s);
  return c.json({ cw: { ...shown(cwSettings), on: !!ctx.cw } });
});

// A file, by id: notes in any workspace link to /api/files/<id>/<name> (a picture can't say
// which workspace it's in). The name after it is for people and is ignored. Never changes, so
// cached for good.
app.get("/api/files/:id/:name?", (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/.test(id)) return c.json({ error: "No such file" }, 404);
  const file = workspaces
    .all()
    .map((w) => w.files.read(id))
    .find((f) => !!f);
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

// Dev notes (devnotes.ts): about the app itself, so one list for the whole server, not per
// workspace. Every change answers with the notes as they are after it.
const devNotes = new DevNotes(workspaces.main.db, devNotesFile(DB_FILE), FILES_DIR);
app.get("/api/devnotes", (c) => c.json({ notes: devNotes.list() }));
app.post("/api/devnotes", async (c) => {
  const b = await c.req.json().catch(() => null);
  const text = typeof b?.text === "string" ? b.text.trim() : "";
  const files = parseFiles(b?.files ?? []);
  const page = b?.page == null ? null : parsePage(b.page);
  if (!text || text.length > DEV_NOTE_MAX || !files || page === undefined) return c.json({ error: "A note (text, files, page) needed" }, 400);
  devNotes.add(text, page, files);
  return c.json({ notes: devNotes.list() });
});
app.post("/api/devnotes/:id", async (c) => {
  const b = await c.req.json().catch(() => null);
  const text = typeof b?.text === "string" ? b.text.trim() : undefined;
  const files = b?.files === undefined ? undefined : parseFiles(b.files);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  if (text === "" || (text && text.length > DEV_NOTE_MAX) || files === null) return c.json({ error: "Not a change to a note" }, 400);
  if (!devNotes.update(c.req.param("id"), { text, files: files ?? undefined, done: bool(b?.done), deleted: bool(b?.deleted) })) {
    return c.json({ error: "No such note" }, 404);
  }
  return c.json({ notes: devNotes.list() });
});

// AI note cleanup (ai.ts): one set of settings and one bill for the whole server, so not per
// workspace. The keys stay here; the app only learns which providers have one.
const ai = new Ai(workspaces.main.db, providersFromEnv());
if (ai.configured().length) console.log(`AI: ${ai.configured().join(", ")}`);
/** The templates for the app's menus, or what's wrong with their files (ai-templates/). */
const aiTemplates = () => {
  try {
    return { templates: ai.templates().templates };
  } catch (err) {
    return { templates: [], templatesError: (err as Error).message };
  }
};
const aiState = () => ({ providers: ai.configured(), models: ai.available().map((m) => m.id), settings: ai.settings(), ...aiTemplates(), usage: ai.usage() });
app.get("/api/ai", (c) => c.json(aiState()));
app.post("/api/ai/settings", async (c) => {
  if (!fromApp(c)) return c.json({ error: "Not from the app" }, 403);
  const s = parseAiSettings(await c.req.json().catch(() => null));
  if ("error" in s) return c.json(s, 400);
  ai.saveSettings(s);
  return c.json(aiState());
});
/** A cleanup's failure as the app shows it. */
const aiFailure = (err: unknown) => {
  if (err instanceof AiStopped) return { error: err.message, status: 409 as const };
  console.error(err);
  return { error: `The AI service refused or couldn't be reached: ${(err as Error).message?.slice(0, 200) ?? "no answer"}`, status: 502 as const };
};
app.post("/api/ai/cleanup", async (c) => {
  const b = await c.req.json().catch(() => null);
  const notes = typeof b?.notes === "string" ? b.notes.trim() : "";
  if (!notes || notes.length > MAX_NOTES) return c.json({ error: notes ? "Those notes are too long to send" : "No notes to clean up" }, 400);
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  try {
    return c.json(await ai.cleanUp(notes, { templateId: str(b.templateId), model: str(b.model), context: str(b.context)?.slice(0, 300) }));
  } catch (err) {
    const f = aiFailure(err);
    return c.json({ error: f.error }, f.status);
  }
});
// The same notes through every model that has a key, side by side (Settings › AI › Compare).
app.post("/api/ai/compare", async (c) => {
  const b = await c.req.json().catch(() => null);
  const notes = typeof b?.notes === "string" ? b.notes.trim() : "";
  if (!notes || notes.length > MAX_NOTES) return c.json({ error: notes ? "Those notes are too long to send" : "No notes to compare" }, 400);
  const templateId = typeof b?.templateId === "string" ? b.templateId : undefined;
  const results = await Promise.all(
    ai.available().map((m) =>
      ai.cleanUp(notes, { model: m.id, templateId, purpose: "compare" }).catch((err) => ({ model: m.id, error: aiFailure(err).error })),
    ),
  );
  return c.json({ results });
});

// Everything else is for one workspace: the X-Sideshow-Workspace header says which (the
// EventSource can't send headers, so ?ws= there). None means the main one, all an app from
// before workspaces knows about.
app.use("/api/*", async (c, next) => {
  const id = c.req.header("x-sideshow-workspace") ?? c.req.query("ws") ?? MAIN;
  const ws = workspaces.get(id);
  if (!ws) return c.json({ error: "No such workspace", workspace: id }, 404);
  c.set("ws", ws);
  await next();
});

/** The workspace's CW parts, if its profile uses ConnectWise and the server has it set up. */
const cwOf = (ws: Workspace) => (ctx.cw && ws.cwParts ? { cw: ctx.cw, ...ws.cwParts, profile: ws.profile, cwSettings: ws.profile.connectwise! } : null);
const NO_CW = { error: "ConnectWise isn't set up for this workspace" };

app.get("/api/state", (c) => {
  const ws = c.get("ws");
  const on = !!cwOf(ws);
  return c.json({
    rev: ws.store.rev,
    state: ws.store.state,
    config: {
      profile: ws.profile,
      cw: on,
      cwPush: on && !!ctx.cwMember,
      cwWeekly: on && !!ws.cwParts?.weekly,
      cwHolds: on && !!ws.cwParts?.holds,
      // A key for at least one AI provider: notes can be cleaned up (✨).
      ai: ai.configured().length > 0,
      cwTicketUrl: on ? ticketUrl() : null,
      workspace: { id: ws.id, name: ws.entry.name },
      workspaces: workspaces.all().map((w) => ({ id: w.id, name: w.entry.name })),
    },
  });
});

app.get("/api/cw/tickets/:id", async (c) => {
  const x = cwOf(c.get("ws"));
  if (!x) return c.json(NO_CW, 503);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Not a ticket number" }, 400);
  try {
    const t = await x.cw.getTicket(id);
    return c.json({ id: t.id, summary: t.summary, company: t.company?.name ?? "", companyId: t.company?.id ?? null, closed: !!t.closedFlag });
  } catch (err) {
    if (err instanceof CwError && err.status === 404) return c.json({ error: `No ticket #${id}` }, 404);
    console.error(err);
    return c.json({ error: "ConnectWise lookup failed" }, 502);
  }
});

// Every CW company, duplicates marked, for the company picker. The client keeps a copy.
app.get("/api/cw/companies", (c) => {
  const x = cwOf(c.get("ws"));
  if (!x) return c.json(NO_CW, 503);
  return c.json({ ...x.companies.status(), companies: x.companies.list() });
});

// Sync now (and answer once it's done). ?full=1 asks every company for its newest ticket again.
app.post("/api/cw/companies/refresh", async (c) => {
  const x = cwOf(c.get("ws"));
  if (!x) return c.json(NO_CW, 503);
  await x.companies.sync(c.req.query("full") === "1");
  return c.json({ ...x.companies.status(), companies: x.companies.list() });
});

// This week's recurring internal ticket, for ▶ WRIT. Asking also looks again if it's due.
app.get("/api/cw/weekly", (c) => {
  const weekly = cwOf(c.get("ws"))?.weekly;
  if (!weekly) return c.json({ error: "ConnectWise push isn't set up for this workspace" }, 503);
  weekly.checkIfDue();
  return c.json({ weekly: weekly.current() });
});
app.post("/api/cw/weekly/refresh", async (c) => {
  const weekly = cwOf(c.get("ws"))?.weekly;
  if (!weekly) return c.json({ error: "ConnectWise push isn't set up for this workspace" }, 503);
  return c.json({ weekly: await weekly.check() });
});

// Schedule holds (holds.ts): blocks that repeat on the member's CW calendar, an entry per day.
// Every change answers with the holds as they are after it; a hold's `error` says what CW refused.
const holdsOf = (ws: Workspace) => (cwOf(ws) ? ws.cwParts?.holds : null) ?? null;
const NO_HOLDS = { error: "Schedule holds need ConnectWise with a member (Settings › Connections)" };
const holdsError = (c: Context, err: unknown) => {
  console.error(err);
  return c.json({ error: "Something went wrong saving that" }, 500);
};
app.get("/api/cw/holds", (c) => {
  const holds = holdsOf(c.get("ws"));
  if (!holds) return c.json(NO_HOLDS, 503);
  return c.json({ holds: holds.list() });
});
app.post("/api/cw/holds", async (c) => {
  const holds = holdsOf(c.get("ws"));
  if (!holds) return c.json(NO_HOLDS, 503);
  const rule = parseRule(await c.req.json().catch(() => null));
  if ("error" in rule) return c.json(rule, 400);
  try {
    const id = await holds.create(rule);
    return c.json({ id, holds: holds.list() });
  } catch (err) {
    return holdsError(c, err);
  }
});
// Try again now (otherwise hourly). Before /:id, which would match it too.
app.post("/api/cw/holds/sync", async (c) => {
  const holds = holdsOf(c.get("ws"));
  if (!holds) return c.json(NO_HOLDS, 503);
  try {
    await holds.sync();
    return c.json({ holds: holds.list() });
  } catch (err) {
    return holdsError(c, err);
  }
});
app.post("/api/cw/holds/:id", async (c) => {
  const holds = holdsOf(c.get("ws"));
  if (!holds) return c.json(NO_HOLDS, 503);
  const rule = parseRule(await c.req.json().catch(() => null));
  if ("error" in rule) return c.json(rule, 400);
  try {
    if (!(await holds.update(c.req.param("id"), rule))) return c.json({ error: "No such hold" }, 404);
    return c.json({ holds: holds.list() });
  } catch (err) {
    return holdsError(c, err);
  }
});
app.delete("/api/cw/holds/:id", async (c) => {
  const holds = holdsOf(c.get("ws"));
  if (!holds) return c.json(NO_HOLDS, 503);
  try {
    if (!(await holds.remove(c.req.param("id")))) return c.json({ error: "No such hold" }, 404);
    return c.json({ holds: holds.list() });
  } catch (err) {
    return holdsError(c, err);
  }
});
// Skip one day ({skip: true}), or make it again ({skip: false}).
app.post("/api/cw/holds/:id/days/:date", async (c) => {
  const holds = holdsOf(c.get("ws"));
  if (!holds) return c.json(NO_HOLDS, 503);
  const b = await c.req.json().catch(() => null);
  if (typeof b?.skip !== "boolean") return c.json({ error: "skip needed" }, 400);
  try {
    const problem = await holds.skip(c.req.param("id"), c.req.param("date"), b.skip);
    return c.json({ holds: holds.list(), ...(problem ? { error: problem } : {}) }, problem === "No such hold" ? 404 : 200);
  } catch (err) {
    return holdsError(c, err);
  }
});

// Rename a ticket: its summary in CW becomes the task's title (Task details' "Update ticket").
// The new summary is recorded on the task like a lookup's, so every device sees it.
app.post("/api/cw/tickets/:id/summary", async (c) => {
  const ws = c.get("ws");
  const x = cwOf(ws);
  if (!x) return c.json(NO_CW, 503);
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => null);
  const summary = typeof b?.summary === "string" ? b.summary.trim() : "";
  const task = typeof b?.taskId === "string" ? ws.store.state.tasks[b.taskId] : undefined;
  if (!Number.isInteger(id) || id <= 0 || !summary || !task) return c.json({ error: "taskId, summary and a ticket number needed" }, 400);
  if (summary.length > 100) return c.json({ error: "ConnectWise allows 100 characters in a summary" }, 400);
  try {
    const t = await x.cw.updateTicketSummary(id, summary);
    const at = Date.now();
    ws.store.apply([
      {
        id: newId(),
        at,
        op: {
          type: "task.refInfo",
          taskId: task.id,
          field: x.cwSettings.ticketField,
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
  const x = cwOf(c.get("ws"));
  if (!x) return c.json(NO_CW, 503);
  try {
    const [boards, owner] = await Promise.all([x.tickets.getBoards(), x.tickets.getOwner().catch(() => null)]);
    return c.json({ boards, owner });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Couldn't reach ConnectWise" }, 502);
  }
});

// Create a CW ticket for a task; its number goes onto the task (an op every device sees).
app.post("/api/cw/tickets", async (c) => {
  const x = cwOf(c.get("ws"));
  if (!x) return c.json(NO_CW, 503);
  const b = await c.req.json().catch(() => null);
  const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined);
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
    pushSessionIds: Array.isArray(b.pushSessionIds) ? b.pushSessionIds.filter((v: unknown) => typeof v === "string") : undefined,
  };
  try {
    const result = await x.tickets.create(req);
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
  const ws = c.get("ws");
  const x = cwOf(ws);
  if (!x || !ctx.cwMember) return c.json({ error: "ConnectWise push isn't set up for this workspace" }, 503);
  const body = await c.req.json().catch(() => null);
  const ids: unknown[] = Array.isArray(body?.sessionIds) ? body.sessionIds : [];
  if (!ids.length || ids.some((v) => typeof v !== "string")) return c.json({ error: "sessionIds needed" }, 400);
  try {
    const results = await pushSessions(x.cw, ws.store, x.profile, ctx.cwMember, ids as string[], x.documents);
    return c.json({ results });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Couldn't reach ConnectWise" }, 502);
  }
});

// Which pushed sessions' CW entries have been deleted in CW; those go back to To enter.
app.post("/api/cw/check", async (c) => {
  const ws = c.get("ws");
  const x = cwOf(ws);
  if (!x) return c.json(NO_CW, 503);
  const body = await c.req.json().catch(() => null);
  const ids: unknown[] = Array.isArray(body?.sessionIds) ? body.sessionIds : [];
  if (ids.some((v) => typeof v !== "string")) return c.json({ error: "sessionIds needed" }, 400);
  try {
    return c.json({ removed: await checkPushed(x.cw, ws.store, ids as string[]) });
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
  const info = c.get("ws").files.save(data, name, c.req.header("content-type") ?? "");
  return c.json({ ...info, url: FileStore.url(info) });
});

app.post("/api/ops", async (c) => {
  const ws = c.get("ws");
  const body = await c.req.json().catch(() => null);
  // The outbox says which workspace its ops were made in, and ops for another one are refused:
  // nothing made in one workspace can land in another. (An app from before workspaces only
  // knows the main one, and doesn't say.)
  if ((body?.workspace ?? MAIN) !== ws.id) return c.json({ error: "These changes are for another workspace", workspace: body?.workspace }, 409);
  const ops: unknown[] = Array.isArray(body?.ops) ? body.ops : [];
  const valid = ops.filter(isOpEnvelope);
  if (valid.length !== ops.length) return c.json({ error: "invalid op" }, 400);
  const changes = ws.store.apply(valid);
  return c.json({ rev: ws.store.rev, changes });
});

// Live updates: every change is pushed to every device on the workspace, and "config" when its
// profile or the workspace names change (devices then fetch the state again).
app.get("/api/events", (c) => {
  const ws = c.get("ws");
  return streamSSE(c, async (stream) => {
    const off = ws.store.onChange((rev, changes) => {
      void stream.writeSSE({ event: "changes", data: JSON.stringify({ rev, changes }) });
    });
    const offConfig = ws.onConfig(() => void stream.writeSSE({ event: "config", data: "{}" }));
    await stream.writeSSE({ event: "hello", data: JSON.stringify({ rev: ws.store.rev }) });
    const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }), 25_000);
    await new Promise<void>((resolve) => stream.onAbort(resolve));
    clearInterval(ping);
    off();
    offConfig();
  });
});

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
  console.log(`sideshow server on http://localhost:${info.port}  (main db: ${DB_FILE}, files: ${FILES_DIR}, backups: ${BACKUP_DIR})`);
});
