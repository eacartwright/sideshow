import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClientErrors, KEEP, parseReport, tailFile, type ClientErrorReport } from "./clienterrors";
import { openDb } from "./db";

const dirs: string[] = [];
const dbs: { close(): void }[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-clienterrors-"));
  dirs.push(dir);
  return dir;
}

function setup() {
  const db = openDb(join(tempDir(), "sideshow.db"));
  dbs.push(db);
  return new ClientErrors(db);
}

const REPORT: ClientErrorReport = { source: "render", message: "Boom", stack: "at x", page: "/", build: "abc1234", device: "Edge" };

describe("client errors", () => {
  it("lists them newest first", () => {
    const errors = setup();
    errors.add(REPORT, 1000);
    errors.add({ ...REPORT, message: "Later" }, 2000);
    expect(errors.list().map((e) => e.message)).toEqual(["Later", "Boom"]);
  });

  it("counts the same error up instead of adding it again", () => {
    const errors = setup();
    errors.add(REPORT, 1000);
    errors.add({ ...REPORT, page: "/other" }, 2000);
    const [e, ...rest] = errors.list();
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ count: 2, firstAt: 1000, lastAt: 2000, page: "/other" });
  });

  it("keeps the same error from another build or device apart", () => {
    const errors = setup();
    errors.add(REPORT);
    errors.add({ ...REPORT, build: "def5678" });
    errors.add({ ...REPORT, device: "iPhone" });
    expect(errors.list()).toHaveLength(3);
  });

  it("keeps only the latest", () => {
    const errors = setup();
    for (let i = 0; i < KEEP + 5; i++) errors.add({ ...REPORT, message: `Error ${i}` }, i);
    const list = errors.list();
    expect(list).toHaveLength(KEEP);
    expect(list[0]!.message).toBe(`Error ${KEEP + 4}`);
    expect(list.at(-1)!.message).toBe("Error 5");
  });
});

describe("parseReport", () => {
  it("needs a message", () => {
    for (const bad of [null, "text", {}, { message: "  " }, { message: 5 }]) expect(parseReport(bad)).toBeNull();
  });

  it("cuts long values and blanks anything that isn't text", () => {
    const r = parseReport({ message: "x".repeat(3000), stack: 7, device: "y".repeat(400) })!;
    expect(r.message).toHaveLength(2000);
    expect(r.stack).toBe("");
    expect(r.device).toHaveLength(300);
  });
});

describe("tailFile", () => {
  it("gives the last lines of a file", () => {
    const file = join(tempDir(), "server.log");
    writeFileSync(file, "one\r\ntwo\nthree\n");
    expect(tailFile(file, 2)).toBe("two\nthree");
    expect(tailFile(file, 50)).toBe("one\ntwo\nthree");
  });

  it("drops the line cut off by the size limit", () => {
    const file = join(tempDir(), "server.log");
    writeFileSync(file, "first line\nsecond\nthird\n");
    expect(tailFile(file, 50, 16)).toBe("second\nthird");
  });

  it("gives null for a file that isn't there", () => {
    expect(tailFile(join(tempDir(), "nothing.log"), 5)).toBeNull();
  });
});
