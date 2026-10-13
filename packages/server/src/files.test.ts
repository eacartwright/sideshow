import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startBackups } from "./backup";
import { openDb } from "./db";
import { cleanName, fileIdsIn, FileStore } from "./files";

const dirs: string[] = [];
const dbs: { close(): void }[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-files-"));
  dirs.push(dir);
  const db = openDb(join(dir, "t.db"));
  dbs.push(db);
  return { dir, db, files: new FileStore(db, join(dir, "files")) };
}

describe("attachments", () => {
  it("stores a file under its id and reads it back", () => {
    const { files } = setup();
    const info = files.save(new TextEncoder().encode("hello"), String.raw`C:\Users\Evan\notes <1>.txt`, "text/plain");
    expect(info).toMatchObject({ name: "notes 1.txt", type: "text/plain", size: 5 });
    expect(FileStore.url(info)).toBe(`/api/files/${info.id}/notes%201.txt`);
    expect(files.read(info.id)?.data.toString()).toBe("hello");
    expect(files.read("nope")).toBeNull();
  });

  it("cleans names and finds the files a note links to", () => {
    expect(cleanName("../../etc/passwd")).toBe("passwd");
    expect(cleanName("   ")).toBe("file");
    const a = "11111111-2222-4333-8444-555555555555";
    const b = "66666666-7777-4888-8999-000000000000";
    expect(fileIdsIn(`![x](/api/files/${a}/x.png) and [y.pdf](/api/files/${b}/y.pdf) and ![x](/api/files/${a}/x.png)`)).toEqual([a, b]);
  });

  it("copies new files to the backup folder", () => {
    const { dir, db, files } = setup();
    const info = files.save(new Uint8Array([1, 2, 3]), "a.png", "image/png");
    startBackups(db, join(dir, "backups"), files.dir);
    expect(readdirSync(join(dir, "backups", "files"))).toEqual([info.id]);
  });
});
