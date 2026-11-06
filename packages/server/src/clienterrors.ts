import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { DB } from "./db";

// What went wrong in a browser (DESIGN.md "Safety nets"): the app reports its crashes here, so they
// can be read later rather than being lost with the tab. One list for the whole server, in the main
// workspace's database. The same error again only counts up, and just the latest KEEP stay.

export interface ClientErrorReport {
  /** What caught it: render, error, promise, note. */
  source: string;
  message: string;
  stack: string;
  /** The page's address. */
  page: string;
  /** The commit the app in that tab was built from; it can be older than the server's. */
  build: string;
  device: string;
}

export interface ClientError extends ClientErrorReport {
  id: number;
  firstAt: number;
  lastAt: number;
  count: number;
}

interface Row {
  id: number;
  source: string;
  message: string;
  stack: string;
  page: string;
  build: string;
  device: string;
  first_at: number;
  last_at: number;
  count: number;
}

const toError = (r: Row): ClientError => ({
  id: r.id,
  source: r.source,
  message: r.message,
  stack: r.stack,
  page: r.page,
  build: r.build,
  device: r.device,
  firstAt: r.first_at,
  lastAt: r.last_at,
  count: r.count,
});

export const KEEP = 500;

/** A report as the app sends it, cut to size; or null if it isn't one. */
export function parseReport(v: unknown): ClientErrorReport | null {
  const b = v as Record<string, unknown> | null;
  if (!b || typeof b.message !== "string" || !b.message.trim()) return null;
  const text = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
  return {
    source: text(b.source, 20),
    message: b.message.slice(0, 2000),
    stack: text(b.stack, 8000),
    page: text(b.page, 300),
    build: text(b.build, 40),
    device: text(b.device, 300),
  };
}

export class ClientErrors {
  constructor(private db: DB) {}

  /** Newest first. */
  list(limit = KEEP): ClientError[] {
    return (this.db.prepare("SELECT * FROM client_errors ORDER BY last_at DESC, id DESC LIMIT ?").all(limit) as unknown as Row[]).map(toError);
  }

  add(r: ClientErrorReport, now = Date.now()) {
    const again = this.db
      .prepare("UPDATE client_errors SET count = count + 1, last_at = ?, page = ? WHERE source = ? AND message = ? AND stack = ? AND build = ? AND device = ?")
      .run(now, r.page, r.source, r.message, r.stack, r.build, r.device);
    if (again.changes) return;
    this.db
      .prepare("INSERT INTO client_errors (source, message, stack, page, build, device, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.source, r.message, r.stack, r.page, r.build, r.device, now, now);
    this.db.prepare("DELETE FROM client_errors WHERE id NOT IN (SELECT id FROM client_errors ORDER BY last_at DESC, id DESC LIMIT ?)").run(KEEP);
  }
}

/** The end of a text file, whole lines only, reading no more than `maxBytes` of it; null if it can't be read. */
export function tailFile(file: string, lines: number, maxBytes = 1024 * 1024): string | null {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const all = buffer.toString("utf8").split(/\r?\n/);
    // Started partway through the file, so the first line is probably cut off.
    if (length < size) all.shift();
    if (all.at(-1) === "") all.pop();
    return all.slice(-lines).join("\n");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
