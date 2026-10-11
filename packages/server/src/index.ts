import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OP_TYPES, type OpEnvelope } from "@sideshow/shared";
import { startBackups } from "./backup";
import { openDb } from "./db";
import { ConnectWiseClient, CwError, configFromEnv } from "./integrations/connectwise/client";
import { checkPushed, pushSessions } from "./integrations/connectwise/push";
import { defaultsBackfill, loadProfile, profileListChanges } from "./profile";
import { Store } from "./store";

const PORT = Number(process.env.PORT ?? 8787);
// The app was called fieldtime until 2026-10: FIELDTIME_* settings still work.
const setting = (name: string) => process.env[`SIDESHOW_${name}`] ?? process.env[`FIELDTIME_${name}`];
const DB_FILE = setting("DB") ?? defaultDbFile();
const BACKUP_DIR = setting("BACKUP_DIR") ?? join(dirname(DB_FILE), "backups");

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
const backups = startBackups(db, BACKUP_DIR);
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
// Pushing time entries also needs whose time it is (a CW member identifier, e.g. ecartwright).
const CW_MEMBER = process.env.CW_MEMBER?.trim() || null;
if (cw && profile.connectwise && !CW_MEMBER) console.log("ConnectWise push is off: set CW_MEMBER in .env");
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
    return c.json({ id: t.id, summary: t.summary, company: t.company?.name ?? "", closed: !!t.closedFlag });
  } catch (err) {
    if (err instanceof CwError && err.status === 404) return c.json({ error: `No ticket #${id}` }, 404);
    console.error(err);
    return c.json({ error: "ConnectWise lookup failed" }, 502);
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
    const results = await pushSessions(cw, store, profile, CW_MEMBER, ids as string[]);
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
  console.log(`sideshow server on http://localhost:${info.port}  (db: ${DB_FILE}, backups: ${BACKUP_DIR})`);
});
