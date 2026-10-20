import { describe, expect, it } from "vitest";
import type { Op, OpEnvelope } from "./ops";
import { applyOp } from "./reducer";
import { emptyState, type State } from "./types";
import { undoOps } from "./undo";

const H = 3_600_000;
const M = 60_000;
const T0 = new Date(2026, 8, 28, 8, 0).getTime();

let n = 0;
const env = (at: number, op: Op): OpEnvelope => ({ id: `op${n++}`, at, op });
function run(state: State, at: number, op: Op) {
  applyOp(state, env(at, op));
}

/** A state with task A (one finished session, a work type and billing) and task B. */
function setup() {
  const s = emptyState();
  run(s, T0, { type: "list.create", itemId: "wt1", list: "workTypes", name: "Remote" });
  run(s, T0, { type: "list.create", itemId: "wt2", list: "workTypes", name: "Onsite" });
  run(s, T0, { type: "list.update", itemId: "wt2", patch: { defaults: { billing: "Billable" } } });
  run(s, T0, { type: "task.create", taskId: "A", title: "Printer", fields: { client: "c1" } });
  run(s, T0, { type: "task.create", taskId: "B", title: "Email", fields: {} });
  run(s, T0, { type: "session.create", sessionId: "a1", taskId: "A", start: T0, end: T0 + H, fields: { workType: "wt1", billing: "No Charge" }, notes: "fixed it" });
  run(s, T0, { type: "session.create", sessionId: "a2", taskId: "A", start: T0 + 2 * H, end: T0 + 3 * H, notes: "more" });
  return s;
}

/** Do `ops`, then undo them: the records should be as they were. */
function roundTrip(s: State, ops: Op[]) {
  const before = structuredClone(s);
  const envs = ops.map((op) => env(T0 + 5 * H, op));
  for (const e of envs) applyOp(s, e);
  const changed = structuredClone(s);
  for (const op of undoOps(before, envs, T0 + 6 * H)) run(s, T0 + 6 * H, op);
  return { before, changed, after: s };
}

const pick = (s: State, id: string) => {
  const x = s.sessions[id]!;
  return { taskId: x.taskId, start: x.start, end: x.end, notes: x.notes, fields: x.fields, deleted: !!x.deleted, enteredAt: x.enteredAt ?? null };
};

describe("undo", () => {
  it("puts back a session dragged on the calendar", () => {
    const { before, changed, after } = roundTrip(setup(), [{ type: "session.update", sessionId: "a1", patch: { start: T0 + 15 * M, end: T0 + 75 * M } }]);
    expect(pick(changed, "a1").start).toBe(T0 + 15 * M);
    expect(pick(after, "a1")).toEqual(pick(before, "a1"));
  });

  it("keeps an entered session entered", () => {
    const s = setup();
    run(s, T0, { type: "session.update", sessionId: "a1", patch: { enteredAt: T0 + 4 * H } });
    const { changed, after } = roundTrip(s, [{ type: "session.update", sessionId: "a1", patch: { end: T0 + 2 * H } }]);
    expect(changed.sessions.a1!.enteredAt).toBeNull();
    expect(after.sessions.a1!.enteredAt).toBe(T0 + 4 * H);
    expect(after.sessions.a1!.changedSinceEntered).toBe(false);
    expect(after.sessions.a1!.end).toBe(T0 + H);
  });

  it("restores fields without a list item's defaults overriding them", () => {
    const { before, changed, after } = roundTrip(setup(), [
      { type: "session.update", sessionId: "a1", patch: { fields: { workType: "wt2" } } },
    ]);
    expect(changed.sessions.a1!.fields).toEqual({ workType: "wt2", billing: "Billable" });
    expect(after.sessions.a1!.fields).toEqual(before.sessions.a1!.fields);
  });

  it("removes a field the change added", () => {
    const { after } = roundTrip(setup(), [{ type: "session.update", sessionId: "a2", patch: { fields: { email: true } } }]);
    expect(after.sessions.a2!.fields).not.toHaveProperty("email");
  });

  it("splits a merge back up", () => {
    const { before, changed, after } = roundTrip(setup(), [{ type: "session.merge", sessionIds: ["a1", "a2"] }]);
    expect(changed.sessions.a2!.deleted).toBe(true);
    expect(pick(after, "a1")).toEqual(pick(before, "a1"));
    expect(pick(after, "a2")).toEqual(pick(before, "a2"));
  });

  it("moves a session back to its task", () => {
    const { before, changed, after } = roundTrip(setup(), [{ type: "session.move", sessionId: "a2", taskId: "B" }]);
    expect(changed.sessions.a2!.taskId).toBe("B");
    expect(changed.sessions.a2!.fields).toEqual({ workType: "wt1", billing: "No Charge" });
    expect(pick(after, "a2")).toEqual(pick(before, "a2"));
  });

  it("moves a session out of a new task and drops the task", () => {
    const { after } = roundTrip(setup(), [
      { type: "task.create", taskId: "N", title: "New", fields: {} },
      { type: "session.move", sessionId: "a2", taskId: "N" },
    ]);
    expect(after.sessions.a2!.taskId).toBe("A");
    expect(after.tasks.N!.deleted).toBe(true);
  });

  it("brings back a task a move dropped", () => {
    const s = setup();
    // ▶ New made X, and its only session moves to B: X goes.
    run(s, T0 + 4 * H, { type: "task.start", taskId: "X", sessionId: "x1", newTask: { title: "" } });
    run(s, T0 + 4 * H + 10 * M, { type: "timer.pause", sessionId: "x1" });
    const { changed, after } = roundTrip(s, [{ type: "session.move", sessionId: "x1", taskId: "B" }]);
    expect(changed.tasks.X!.deleted).toBe(true);
    expect(after.tasks.X!.deleted).toBe(false);
    expect(after.sessions.x1!.taskId).toBe("X");
    expect(after.sessions.x1!.deleted).toBe(false);
  });

  it("deletes a session added (and the task made for it)", () => {
    const { after } = roundTrip(setup(), [
      { type: "task.create", taskId: "N", title: "Drive", fields: {} },
      { type: "session.create", sessionId: "n1", taskId: "N", start: T0 + 4 * H, end: T0 + 5 * H },
    ]);
    expect(after.sessions.n1!.deleted).toBe(true);
    expect(after.tasks.N!.deleted).toBe(true);
  });

  it("brings back deleted sessions and tasks", () => {
    const one = roundTrip(setup(), [{ type: "session.delete", sessionId: "a1" }]);
    expect(one.after.sessions.a1!.deleted).toBe(false);
    const all = roundTrip(setup(), [{ type: "task.delete", taskId: "A" }]);
    expect(all.after.tasks.A!.deleted).toBe(false);
    expect(all.after.sessions.a1!.deleted).toBe(false);
    expect(all.after.sessions.a2!.deleted).toBe(false);
  });

  it("puts back task fields and status", () => {
    const { before, after } = roundTrip(setup(), [
      { type: "task.update", taskId: "A", patch: { fields: { client: "c2", ticket: "123" } } },
      { type: "task.update", taskId: "A", patch: { status: "done" } },
    ]);
    expect(after.tasks.A!.fields).toEqual(before.tasks.A!.fields);
    expect(after.tasks.A!.status).toBe("open");
  });

  it("does nothing for ops that changed nothing", () => {
    const s = setup();
    expect(undoOps(s, [env(T0, { type: "session.update", sessionId: "a1", patch: { notes: "fixed it" } })], T0)).toEqual([]);
  });
});
