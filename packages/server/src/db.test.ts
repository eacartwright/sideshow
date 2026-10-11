import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadState, openDb, saveChanges } from "./db";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-db-"));
  dirs.push(dir);
  return join(dir, "test.db");
}

describe("migration 8: profile fields", () => {
  it("moves client, ticket # and work type into fields and lists, keeping ids", () => {
    const file = tempDb();
    const old = openDb(file, 7);
    old.exec(`
      INSERT INTO groups VALUES ('g1', 'Acme', 0, 1, 2, 3);
      INSERT INTO groups VALUES ('g2', 'Old client', 1, 1, 2, 3);
      INSERT INTO categories VALUES ('remote-business-hours', 'Remote - Business Hours', 0, 0, 1);
      INSERT INTO categories VALUES ('office', 'Office', 3, 0, 1);
      INSERT INTO tasks (id, title, group_id, ref, description, status, created_at, updated_at, rev, ref_info)
        VALUES ('t1', 'Firewall', 'g1', ' #106745 ', '', 'open', 1, 2, 3,
                '{"summary":"API test","company":"Veritaz","closed":false,"fetchedAt":5}');
      INSERT INTO tasks (id, title, group_id, ref, description, status, created_at, updated_at, rev)
        VALUES ('t2', 'No fields', NULL, '', '', 'open', 1, 2, 3);
      INSERT INTO sessions (id, task_id, start, "end", deduct_min, notes, category_id, updated_at, rev)
        VALUES ('s1', 't1', 10, 20, 0, 'did things', 'office', 20, 3);
      INSERT INTO sessions (id, task_id, start, "end", deduct_min, notes, category_id, updated_at, rev)
        VALUES ('s2', 't2', 30, NULL, 0, '', NULL, 30, 3);
    `);
    old.close();

    const db = openDb(file);
    expect(existsSync(`${file}.before-v8.db`)).toBe(true);
    const s = loadState(db);
    expect(s.lists.g1).toMatchObject({ list: "clients", name: "Acme", archived: false, rev: 3 });
    expect(s.lists.g2).toMatchObject({ list: "clients", archived: true });
    expect(s.lists.office).toMatchObject({ list: "workTypes", name: "Office", position: 3 });
    expect(s.tasks.t1!.fields).toEqual({ client: "g1", ticket: " #106745 " });
    expect(s.tasks.t1!.refInfo).toMatchObject({ field: "ticket", ref: "106745", summary: "API test" });
    expect(s.tasks.t2!.fields).toEqual({});
    expect(s.sessions.s1!.fields).toEqual({ workType: "office" });
    expect(s.sessions.s2!.fields).toEqual({});

    // And it round-trips through save.
    saveChanges(db, { lists: [], projects: [], tasks: [s.tasks.t1!], sessions: [s.sessions.s1!] });
    const again = loadState(db);
    expect(again.tasks.t1).toEqual(s.tasks.t1);
    expect(again.sessions.s1).toEqual(s.sessions.s1);
    db.close();
  });

  it("a new database needs no copy and starts empty", () => {
    const file = tempDb();
    const db = openDb(file);
    expect(existsSync(`${file}.before-v1.db`)).toBe(false);
    expect(loadState(db)).toMatchObject({ lists: {}, tasks: {}, sessions: {} });
    db.close();
  });
});

describe("migration 9: integration data", () => {
  it("migration 10 titles linked tasks with their ticket's summary, in a new rev", () => {
    const file = tempDb();
    const old = openDb(file, 9);
    old.exec(`
      INSERT INTO meta VALUES ('rev', '7');
      INSERT INTO tasks (id, title, fields, ref_info, description, status, created_at, updated_at, rev)
        VALUES ('t1', 'tests', '{}', '{"field":"ticket","ref":"1","summary":" API test ","company":"V","closed":false,"fetchedAt":5}', '', 'open', 1, 2, 3);
      INSERT INTO tasks (id, title, fields, ref_info, description, status, created_at, updated_at, rev)
        VALUES ('t2', 'Mine', '{}', NULL, '', 'open', 1, 2, 3);
    `);
    old.close();
    const db = openDb(file);
    const s = loadState(db);
    db.close();
    expect(s.tasks.t1).toMatchObject({ title: "API test", rev: 8 });
    expect(s.tasks.t2).toMatchObject({ title: "Mine", rev: 3 });
  });

  it("saves and loads a session's ext; older sessions get an empty one", () => {
    const file = tempDb();
    const old = openDb(file, 8);
    old.exec(`
      INSERT INTO tasks (id, title, fields, description, status, created_at, updated_at, rev) VALUES ('t1', 'A', '{}', '', 'open', 1, 1, 1);
      INSERT INTO sessions (id, task_id, start, "end", deduct_min, notes, fields, updated_at, rev) VALUES ('s1', 't1', 10, 20, 0, '', '{}', 20, 1);
    `);
    old.close();
    const db = openDb(file);
    expect(loadState(db).sessions.s1!.ext).toEqual({});
    const s1 = { ...loadState(db).sessions.s1!, ext: { cw: { entryId: 501, email: true } } };
    saveChanges(db, { lists: [], projects: [], tasks: [], sessions: [s1] });
    expect(loadState(db).sessions.s1!.ext).toEqual({ cw: { entryId: 501, email: true } });
    db.close();
  });
});
