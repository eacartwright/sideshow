import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId, type Op, type Profile } from "@sideshow/shared";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../../db";
import { loadProfile } from "../../profile";
import { Store } from "../../store";
import type { ConnectWiseClient } from "./client";
import { TicketMaker } from "./tickets";

const dirs: string[] = [];
const dbs: { close(): void }[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-tk-"));
  dirs.push(dir);
  const db = openDb(join(dir, "t.db"));
  dbs.push(db);
  const store = new Store(db);
  const run = (op: Op) => store.apply([{ id: newId(), at: Date.now(), op }]);
  run({ type: "list.create", itemId: "vz", list: "clients", name: "Veritaz IT Solutions", ext: { cw: { companyId: 19300 } } });
  run({ type: "list.create", itemId: "acme", list: "clients", name: "Acme" });
  run({ type: "task.create", taskId: "A", title: "Printer offline", fields: { client: "vz" } });
  run({ type: "task.create", taskId: "B", title: "Not linked", fields: { client: "acme" } });
  // Time already on A from before it had a ticket: one ready to push, one without a work type.
  run({ type: "list.create", itemId: "remote", list: "workTypes", name: "Remote - Business Hours" });
  run({ type: "session.create", sessionId: "a1", taskId: "A", start: Date.UTC(2026, 9, 10, 14), end: Date.UTC(2026, 9, 10, 15) });
  run({ type: "session.update", sessionId: "a1", patch: { notes: "fixed it", fields: { workType: "remote", billing: "Billable" } } });
  run({ type: "session.create", sessionId: "a2", taskId: "A", start: Date.UTC(2026, 9, 10, 16), end: Date.UTC(2026, 9, 10, 17) });
  run({ type: "session.update", sessionId: "a2", patch: { fields: { workType: null } } });
  run({ type: "session.create", sessionId: "b1", taskId: "B", start: Date.UTC(2026, 9, 10, 9), end: Date.UTC(2026, 9, 10, 10) });
  const made: any[] = [];
  const entries: any[] = [];
  const cw = {
    findMembers: async () => [{ id: 192, identifier: "ecartwright", firstName: "Evan", lastName: "Cartwright" }],
    createTicket: async (t: any) => {
      made.push(t);
      return { id: 106800, summary: t.summary, company: { id: t.companyId, name: "Veritaz IT Solutions" } };
    },
    getWorkTypes: async () => [{ id: 3, name: "Remote - Business Hours" }],
    ticketKind: async () => "ServiceTicket",
    createTimeEntry: async (e: any) => {
      entries.push(e);
      return { id: 900 + entries.length };
    },
  } as unknown as ConnectWiseClient;
  const profile: Profile = loadProfile("veritaz-cw");
  return { store, made, entries, maker: new TicketMaker(cw, store, profile, "ecartwright") };
}

describe("creating a CW ticket from a task", () => {
  it("makes it on the client's linked company, assigned, and puts the number on the task", async () => {
    const { store, made, maker } = setup();
    const res = await maker.create({ taskId: "A", summary: " Front desk printer offline ", boardId: 1, typeId: 200, assign: true });
    expect(res).toEqual({ ticketId: 106800 });
    expect(made).toEqual([
      expect.objectContaining({ summary: "Front desk printer offline", companyId: 19300, boardId: 1, typeId: 200, ownerId: 192 }),
    ]);
    expect(store.state.tasks.A).toMatchObject({
      title: "Front desk printer offline",
      fields: { client: "vz", ticket: "106800" },
      refInfo: { ref: "106800", companyId: 19300, closed: false },
    });
  });

  it("then pushes the task's time to the new ticket, and only that task's", async () => {
    const { store, entries, maker } = setup();
    const res = await maker.create({ taskId: "A", summary: "x", boardId: 1, assign: true, pushSessionIds: ["a1", "a2", "b1"] });
    expect(res).toMatchObject({
      ticketId: 106800,
      pushed: [
        { sessionId: "a1", ok: true, entryId: 901 },
        { sessionId: "a2", ok: false, error: "No work type" },
      ],
    });
    expect(entries).toEqual([expect.objectContaining({ chargeToId: 106800, notes: "fixed it", emailContactFlag: false })]);
    expect(store.state.sessions.a1).toMatchObject({ ext: { cw: { entryId: 901, ticket: 106800 } } });
    expect(store.state.sessions.a1!.enteredAt).toBeGreaterThan(0);
    expect(store.state.sessions.b1!.enteredAt ?? null).toBeNull();
  });

  it("leaves the owner off when asked, so it waits on the board", async () => {
    const { made, maker } = setup();
    await maker.create({ taskId: "A", summary: "x", boardId: 1, assign: false });
    expect(made[0].ownerId).toBeUndefined();
  });

  it("refuses a task that has a ticket, an unlinked client, and a long summary", async () => {
    const { made, maker } = setup();
    await maker.create({ taskId: "A", summary: "x", boardId: 1, assign: true });
    expect(await maker.create({ taskId: "A", summary: "again", boardId: 1, assign: true })).toEqual({ error: "This task already has a ticket" });
    expect(await maker.create({ taskId: "B", summary: "x", boardId: 1, assign: true })).toEqual({
      error: "Acme isn't linked to a ConnectWise company",
    });
    expect(await maker.create({ taskId: "A", summary: "y".repeat(101), boardId: 1, assign: true })).toMatchObject({ error: expect.stringMatching(/100/) });
    expect(made).toHaveLength(1);
  });

  it("makes one ticket when asked twice at once", async () => {
    const { made, maker } = setup();
    const [a, b] = await Promise.all([
      maker.create({ taskId: "A", summary: "x", boardId: 1, assign: true }),
      maker.create({ taskId: "A", summary: "x", boardId: 1, assign: true }),
    ]);
    expect(made).toHaveLength(1);
    expect([a, b]).toContainEqual({ error: "A ticket is already being made for this task" });
  });
});
