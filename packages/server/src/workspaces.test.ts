import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Op, State } from "@sideshow/shared";
import { Workspaces, type WorkspaceContext } from "./workspaces";

const open: Workspaces[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
vi.spyOn(console, "log").mockImplementation(() => {});

function context(envProfile?: string): WorkspaceContext {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-ws-"));
  dirs.push(dir);
  return {
    dataDir: dir,
    mainDbFile: join(dir, "sideshow.db"),
    backupDir: join(dir, "backups"),
    filesDir: join(dir, "files"),
    envProfile,
    cw: null,
    cwMember: null,
  };
}
function start(ctx: WorkspaceContext) {
  const w = new Workspaces(ctx);
  open.push(w);
  return w;
}
function reopen(w: Workspaces, ctx: WorkspaceContext) {
  w.close();
  open.splice(open.indexOf(w), 1);
  return start(ctx);
}
let n = 0;
const op = (o: Op) => ({ id: `op${n++}`, at: Date.UTC(2026, 9, 20, 13), op: o });
/** The records as they'd be shown or pushed (rev is the server's counter, not content). */
const content = (s: State) => JSON.stringify({ ...s, settings: null }, (k, v) => (k === "rev" ? undefined : v));

describe("workspaces", () => {
  it("is just the main one without workspaces.json, its profile from PROFILE", () => {
    const ctx = context("veritaz-cw");
    const w = start(ctx);
    expect(w.all().map((x) => x.id)).toEqual(["main"]);
    expect(w.main.profileFile()).toBe("veritaz-cw");
    expect(w.main.profile.connectwise).toBeTruthy();
    expect(existsSync(join(ctx.dataDir, "workspaces.json"))).toBe(false);
  });

  it("keeps a new workspace's data in its own database", () => {
    const ctx = context("veritaz-cw");
    let w = start(ctx);
    const personal = w.create("Personal", "");
    expect(personal.id).toBe("personal");
    expect(existsSync(join(ctx.dataDir, "workspaces", "personal.db"))).toBe(true);
    personal.store.apply([op({ type: "task.create", taskId: "p1", title: "Garden" })]);
    w.main.store.apply([op({ type: "task.create", taskId: "m1", title: "Printer" })]);
    expect(Object.keys(personal.store.state.tasks)).toEqual(["p1"]);
    expect(Object.keys(w.main.store.state.tasks)).toEqual(["m1"]);
    // No profile: no work types seeded there.
    expect(Object.keys(personal.store.state.lists)).toEqual([]);

    w = reopen(w, ctx);
    expect(w.all().map((x) => [x.id, x.entry.name])).toEqual([
      ["main", "Main"],
      ["personal", "Personal"],
    ]);
    expect(Object.keys(w.get("personal")!.store.state.tasks)).toEqual(["p1"]);
    // The main workspace still follows PROFILE until it's changed in the app.
    expect(w.main.profileFile()).toBe("veritaz-cw");
  });

  it("gives each workspace an id of its own", () => {
    const w = start(context());
    expect(w.create("Personal", "").id).toBe("personal");
    expect(w.create("Personal", "").id).toBe("personal-2");
    expect(w.create("Main", "").id).toBe("main-2");
    expect(w.create("2027", "").id).toBe("w-2027");
    expect(w.create("!!!", "").id).toBe("workspace");
  });

  it("refuses a profile that doesn't exist, changing nothing", () => {
    const ctx = context("veritaz-cw");
    const w = start(ctx);
    expect(() => w.create("Bad", "nope")).toThrow();
    expect(() => w.setProfile("main", "nope")).toThrow();
    expect(w.all().map((x) => x.id)).toEqual(["main"]);
    expect(w.main.profileFile()).toBe("veritaz-cw");
  });

  it("CW → no profile → CW leaves every record exactly as it was", () => {
    const ctx = context("veritaz-cw");
    let w = start(ctx);
    const store = w.main.store;
    const at = Date.UTC(2026, 9, 20, 13);
    store.apply([
      op({ type: "list.create", itemId: "acme", list: "clients", name: "Acme Dental", ext: { cw: { companyId: 7 } } }),
      op({ type: "task.create", taskId: "t1", title: "Printer", fields: { client: "acme", ticket: "106745" } }),
      op({ type: "session.create", sessionId: "s1", taskId: "t1", start: at, end: at + 3_600_000, notes: "Fixed it", fields: { workType: "onsite-business-hours", noteTo: "Discussion" } }),
      op({ type: "session.update", sessionId: "s1", patch: { ext: { cw: { entryId: 555, ticket: 106745, pushedAt: at } }, enteredAt: at } }),
      op({ type: "session.create", sessionId: "s2", taskId: "t1", start: at + 7_200_000, end: at + 9_000_000, fields: { workType: "office", billing: "No Charge" } }),
    ]);
    expect(store.state.sessions.s1!.fields.billing).toBe("Billable"); // the work type's default
    // As loaded from the database (which spells out empty values the in-memory copy leaves off).
    w = reopen(w, ctx);
    const before = content(w.main.store.state);

    w.setProfile("main", "");
    expect(w.main.profile.fields).toEqual([]);
    expect(content(w.main.store.state)).toBe(before);

    // Restarted in between, as the mini PC might be.
    w = reopen(w, ctx);
    expect(w.main.profileFile()).toBe("");
    expect(content(w.main.store.state)).toBe(before);

    w.setProfile("main", "veritaz-cw");
    expect(content(w.main.store.state)).toBe(before);
    w = reopen(w, ctx);
    expect(w.main.profileFile()).toBe("veritaz-cw");
    expect(content(w.main.store.state)).toBe(before);

    // A copy was saved before each change.
    expect(readdirSync(ctx.backupDir).filter((f) => f.includes("before-profile"))).toHaveLength(2);
  });

  it("fills a profile's lists into a workspace that hasn't got them", () => {
    const ctx = context();
    const w = start(ctx);
    const personal = w.create("Personal", "");
    personal.store.apply([op({ type: "task.create", taskId: "p1", title: "Garden", fields: {} })]);
    w.setProfile("personal", "veritaz-cw");
    const workTypes = Object.values(personal.store.state.lists).filter((x) => x.list === "workTypes");
    expect(workTypes.length).toBeGreaterThan(5);
    expect(personal.store.state.tasks.p1!.title).toBe("Garden");
  });
});
