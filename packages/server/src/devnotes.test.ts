import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./db";
import { DevNotes, parseFiles, parsePage } from "./devnotes";

const dirs: string[] = [];
const dbs: { close(): void }[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FILE = { id: "0b0e7a52-3f7c-4f5e-9d38-2a1f0c9e4b11", name: "screenshot.png", type: "image/png" };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-devnotes-"));
  dirs.push(dir);
  const db = openDb(join(dir, "sideshow.db"));
  dbs.push(db);
  const md = join(dir, "dev-notes.md");
  return { notes: new DevNotes(db, md, join(dir, "files")), md };
}

describe("dev notes", () => {
  it("keeps notes newest first, with their page and files", () => {
    const { notes } = setup();
    notes.add("First", null, [], 1000);
    notes.add("Title wraps badly", { label: "Task details: Printer offline", taskId: "t1" }, [FILE], 2000);
    expect(notes.list().map((n) => n.text)).toEqual(["Title wraps badly", "First"]);
    expect(notes.list()[0]).toMatchObject({ page: { label: "Task details: Printer offline", taskId: "t1" }, files: [FILE], done: false });
  });

  it("changes text, Done and files; a delete can be undone", () => {
    const { notes } = setup();
    const { id } = notes.add("Typo", null, []);
    expect(notes.update(id, { text: "Fixed", done: true, files: [FILE] })).toBe(true);
    expect(notes.list()[0]).toMatchObject({ text: "Fixed", done: true, files: [FILE] });
    notes.update(id, { deleted: true });
    expect(notes.list()).toEqual([]);
    notes.update(id, { deleted: false });
    expect(notes.list().length).toBe(1);
    expect(notes.update("nope", { done: true })).toBe(false);
  });

  it("mirrors them to dev-notes.md, open then done, with where the files are", () => {
    const { notes, md } = setup();
    const a = notes.add("Line one\nline two", { label: "Entries · Thu, Oct 29" }, [FILE], Date.UTC(2026, 9, 29));
    notes.add("Done one", null, [], Date.UTC(2026, 9, 28));
    notes.update(notes.list()[1]!.id, { done: true });
    const text = readFileSync(md, "utf8");
    expect(text).toContain("## Open (1)\n\n- Line one\n  line two (2026-10-29, Entries · Thu, Oct 29, id " + a.id + ")\n  - attached: files/" + FILE.id + " (screenshot.png, image/png)");
    expect(text).toContain("## Done (1)\n\n- Done one (2026-10-28, id ");
  });

  it("checks what the app sends", () => {
    expect(parseFiles([FILE])).toEqual([FILE]);
    expect(parseFiles([{ ...FILE, id: "../../.env" }])).toBeNull();
    expect(parseFiles("x")).toBeNull();
    expect(parsePage({ label: " Now " })).toEqual({ label: "Now" });
    expect(parsePage({ label: "" })).toBeUndefined();
    expect(parsePage(null)).toBeNull();
  });
});
