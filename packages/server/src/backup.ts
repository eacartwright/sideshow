import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db";

// Daily copy of the database. VACUUM INTO writes a consistent, compact snapshot
// even while the server is running. The first check after midnight (or at startup)
// makes that day's file, so it holds everything up to the end of the previous day.
// Attachments (files.ts) never change once saved, so they're copied to <dir>/files once each,
// hourly, and never pruned: a restored database still finds every file it links to.
// Each workspace (workspaces.ts) has its own files: sideshow-<date>.db for the main one,
// sideshow-<workspace>-<date>.db for the others.

const KEEP = 30;

const pad = (n: number) => n.toString().padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * A snapshot of the database as it is now, e.g. before its profile changes. Returns the file.
 * A name already taken (two in the same second) gets -2, -3….
 */
export function snapshot(db: DB, dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  let file = join(dir, `${name}.db`);
  for (let n = 2; existsSync(file); n++) file = join(dir, `${name}-${n}.db`);
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  return file;
}

// The folder may be a network share (the mini PC backs up to the NAS), so a failure here is
// logged and retried next hour; it must never stop the server or fail /api/health.
export function startBackups(db: DB, dir: string, filesDir?: string, prefix = "sideshow") {
  let latest: string | null = null;
  // fieldtime-* are from before the rename; they count toward KEEP and age out first (they sort first).
  const pattern = prefix === "sideshow" ? /^(sideshow|fieldtime)-\d{4}-\d{2}-\d{2}\.db$/ : new RegExp(String.raw`^${prefix}-\d{4}-\d{2}-\d{2}\.db$`);

  const run = () => {
    try {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${prefix}-${localDate(new Date())}.db`);
      if (!existsSync(file)) {
        db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
        console.log(`backup: ${file}`);
      }
      const files = readdirSync(dir).filter((f) => pattern.test(f)).sort();
      for (const old of files.slice(0, -KEEP)) rmSync(join(dir, old));
      latest = files.at(-1) ?? null;
    } catch (err) {
      console.error(`backup failed (${dir}):`, err);
    }
    if (filesDir) {
      try {
        const to = join(dir, "files");
        mkdirSync(to, { recursive: true });
        const have = new Set(readdirSync(to));
        let copied = 0;
        for (const f of existsSync(filesDir) ? readdirSync(filesDir) : []) {
          if (have.has(f)) continue;
          copyFileSync(join(filesDir, f), join(to, f));
          copied++;
        }
        if (copied) console.log(`backup: ${copied} new attachment${copied === 1 ? "" : "s"} → ${to}`);
      } catch (err) {
        console.error(`attachment backup failed (${dir}):`, err);
      }
    }
  };

  run();
  const timer = setInterval(run, 60 * 60_000).unref();
  return { latest: () => latest, stop: () => clearInterval(timer) };
}
