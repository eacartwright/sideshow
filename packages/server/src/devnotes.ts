import { writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { newId } from "@sideshow/shared";
import type { DB } from "./db";

// Dev notes (DESIGN.md §7): ideas, bugs and oddities about sideshow itself, kept apart from the
// work. One list for the whole server, in the main workspace's database. Every change also
// rewrites dev-notes.md beside the data, so Claude can read them on the mini PC without opening
// the live database.

export interface DevNoteFile {
  id: string;
  name: string;
  type: string;
}

export interface DevNote {
  id: string;
  text: string;
  createdAt: number;
  done: boolean;
  /** Where it was written: "Entries · Thu, Oct 29", or a task (which can be opened again). */
  page: { label: string; taskId?: string } | null;
  files: DevNoteFile[];
  deleted: boolean;
}

interface Row {
  id: string;
  text: string;
  created_at: number;
  done: number;
  page: string | null;
  files: string;
  deleted: number;
}

const toNote = (r: Row): DevNote => ({
  id: r.id,
  text: r.text,
  createdAt: r.created_at,
  done: !!r.done,
  page: r.page ? JSON.parse(r.page) : null,
  files: JSON.parse(r.files),
  deleted: !!r.deleted,
});

export const TEXT_MAX = 10_000;

/** Files as the app sends them, checked; or null if they aren't. */
export function parseFiles(v: unknown): DevNoteFile[] | null {
  if (!Array.isArray(v)) return null;
  const ok = v.every((f) => f && typeof f.id === "string" && /^[0-9a-f-]{36}$/.test(f.id) && typeof f.name === "string" && typeof f.type === "string");
  return ok ? v.map((f) => ({ id: f.id, name: f.name.slice(0, 200), type: f.type.slice(0, 100) })) : null;
}

/** A page as the app sends it, checked: a label and maybe a task. */
export function parsePage(v: unknown): DevNote["page"] | undefined {
  if (v === null) return null;
  const p = v as { label?: unknown; taskId?: unknown };
  if (!p || typeof p.label !== "string" || !p.label.trim()) return undefined;
  return { label: p.label.trim().slice(0, 200), ...(typeof p.taskId === "string" ? { taskId: p.taskId } : {}) };
}

export class DevNotes {
  constructor(
    private db: DB,
    /** dev-notes.md, and the files folder its links point into. */
    private mdFile: string,
    private filesDir: string,
  ) {
    this.writeMarkdown();
  }

  /** Every note not deleted, newest first. */
  list(): DevNote[] {
    return (this.db.prepare("SELECT * FROM dev_notes WHERE deleted = 0 ORDER BY created_at DESC, id").all() as unknown as Row[]).map(toNote);
  }

  add(text: string, page: DevNote["page"], files: DevNoteFile[], now = Date.now()): DevNote {
    const note: DevNote = { id: newId(), text, createdAt: now, done: false, page, files, deleted: false };
    this.db
      .prepare("INSERT INTO dev_notes (id, text, created_at, page, files) VALUES (?, ?, ?, ?, ?)")
      .run(note.id, text, now, page ? JSON.stringify(page) : null, JSON.stringify(files));
    this.writeMarkdown();
    return note;
  }

  /** Change a note's text, Done, files, or deleted (deleting can be undone). False if there's no such note. */
  update(id: string, patch: { text?: string; done?: boolean; files?: DevNoteFile[]; deleted?: boolean }): boolean {
    const sets: string[] = [];
    const values: (string | number)[] = [];
    const set = (column: string, value: string | number) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };
    if (patch.text !== undefined) set("text", patch.text);
    if (patch.done !== undefined) set("done", patch.done ? 1 : 0);
    if (patch.files !== undefined) set("files", JSON.stringify(patch.files));
    if (patch.deleted !== undefined) set("deleted", patch.deleted ? 1 : 0);
    if (!sets.length) return !!this.db.prepare("SELECT 1 FROM dev_notes WHERE id = ?").get(id);
    const r = this.db.prepare(`UPDATE dev_notes SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
    if (r.changes) this.writeMarkdown();
    return !!r.changes;
  }

  markdown(now = Date.now()): string {
    const notes = this.list().reverse();
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    // Attachments as paths from this file, so they can be opened from here.
    const folder = relative(dirname(this.mdFile), this.filesDir).replaceAll("\\", "/") || ".";
    const line = (n: DevNote) =>
      `- ${n.text.replace(/\n/g, "\n  ")} (${day(n.createdAt)}${n.page ? `, ${n.page.label}` : ""}, id ${n.id})` +
      n.files.map((f) => `\n  - attached: ${folder}/${f.id} (${f.name}, ${f.type || "?"})`).join("");
    const open = notes.filter((n) => !n.done);
    const done = notes.filter((n) => n.done);
    return [
      "# sideshow dev notes",
      "",
      `Written by the server at ${new Date(now).toISOString()}. Edit them in the app (🧪 in the header), not here.`,
      "",
      `## Open (${open.length})`,
      "",
      ...open.map(line),
      "",
      `## Done (${done.length})`,
      "",
      ...done.map(line),
      "",
    ].join("\n");
  }

  /** Never fails a change: the file is a convenience. */
  private writeMarkdown() {
    try {
      writeFileSync(this.mdFile, this.markdown());
    } catch (err) {
      console.error(`Couldn't write ${this.mdFile}:`, err);
    }
  }
}

/** Where dev-notes.md goes: beside the main database. */
export const devNotesFile = (mainDbFile: string) => join(dirname(mainDbFile), "dev-notes.md");
