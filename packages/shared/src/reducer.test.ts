import { describe, expect, it } from "vitest";
import { displayTitle, firstLine, plainNote, projectPath, projectTree, sessionsByTask } from "./derive";
import type { Op, OpEnvelope, StartMode } from "./ops";
import { applyOp, openSessions } from "./reducer";
import { emptyState, type State } from "./types";

const H = 3_600_000;
const M = 60_000;
const S = 1000;
const T0 = new Date(2026, 8, 28, 8, 0).getTime(); // Mon 8:00

let n = 0;
function run(state: State, at: number, op: Op) {
  const env: OpEnvelope = { id: `op${n++}`, at, op };
  applyOp(state, env);
}
const startNew = (s: State, at: number, taskId: string, mode?: StartMode) =>
  run(s, at, { type: "task.start", taskId, sessionId: `${taskId}@${at}`, newTask: { title: "" }, mode });
const cont = (s: State, at: number, taskId: string, mode?: StartMode) =>
  run(s, at, { type: "task.start", taskId, sessionId: `${taskId}@${at}`, mode });
const stop = (s: State, at: number, sessionId?: string) => run(s, at, { type: "timer.stop", sessionId });
const note = (s: State, at: number, sessionId: string, notes: string) =>
  run(s, at, { type: "session.update", sessionId, patch: { notes } });

const live = (s: State, taskId: string) => sessionsByTask(s).get(taskId) ?? [];
const openTasks = (s: State) => openSessions(s).map((x) => x.taskId).sort();
const span = (s: State, id: string) => {
  const x = s.sessions[id]!;
  return [x.start, x.end];
};

describe("switching", () => {
  it("starting a task stops the running one at the same instant", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B");
    expect(span(s, `A@${T0}`)).toEqual([T0, T0 + H]);
    expect(openTasks(s)).toEqual(["B"]);
  });

  it("continuing an earlier task opens a new session on it", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B");
    startNew(s, T0 + 2 * H, "C");
    cont(s, T0 + 3 * H, "A");
    expect(live(s, "A")).toHaveLength(2);
    expect(openTasks(s)).toEqual(["A"]);
  });

  it("stop with no target stops everything", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + M, "B", "alongside");
    stop(s, T0 + H);
    expect(openTasks(s)).toEqual([]);
  });

  it("new session inherits the task's previous work type", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    run(s, T0 + M, { type: "session.update", sessionId: `A@${T0}`, patch: { fields: { workType: "remote" } } });
    startNew(s, T0 + H, "B");
    cont(s, T0 + 2 * H, "A");
    expect(s.sessions[`A@${T0 + 2 * H}`]!.fields.workType).toBe("remote");
  });

  it("finishing a running task stops it", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    run(s, T0 + H, { type: "task.update", taskId: "A", patch: { status: "done" } });
    expect(openTasks(s)).toEqual([]);
  });

  it("applying the same start twice is harmless", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0, "A");
    expect(Object.keys(s.sessions)).toHaveLength(1);
  });
});

describe("alongside", () => {
  it("runs several tasks at once", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + M, "B", "alongside");
    startNew(s, T0 + 2 * M, "C", "alongside");
    expect(openTasks(s)).toEqual(["A", "B", "C"]);
  });

  it("stopping one leaves the others running", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + M, "B", "alongside");
    stop(s, T0 + H, `A@${T0}`);
    expect(openTasks(s)).toEqual(["B"]);
  });

  it("a switch stops all of them", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + M, "B", "alongside");
    startNew(s, T0 + H, "C");
    expect(openTasks(s)).toEqual(["C"]);
  });

  it("a task never gets two open sessions", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    cont(s, T0 + H, "A", "alongside");
    cont(s, T0 + 2 * H, "A");
    expect(live(s, "A")).toHaveLength(1);
    expect(openTasks(s)).toEqual(["A"]);
  });
});

describe("blips and resuming", () => {
  it("discards a short, empty session on a task that already has time", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B");
    cont(s, T0 + 2 * H, "A"); // oops
    startNew(s, T0 + 2 * H + 10 * S, "C"); // 10s later
    expect(live(s, "A")).toHaveLength(1);
  });

  it("keeps a short session if notes were written", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B");
    cont(s, T0 + 2 * H, "A");
    note(s, T0 + 2 * H + 5 * S, `A@${T0 + 2 * H}`, "quick check");
    startNew(s, T0 + 2 * H + 10 * S, "C");
    expect(live(s, "A")).toHaveLength(2);
  });

  it("keeps a new task's first session however short", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + 5 * S, "B");
    expect(live(s, "A")).toHaveLength(1);
  });

  it("coming back within the gap reopens the previous session", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + 5 * M, "B");
    cont(s, T0 + 10 * M, "A");
    startNew(s, T0 + 15 * M, "B2");
    cont(s, T0 + 20 * M, "A");
    const a = live(s, "A");
    expect(a).toHaveLength(1);
    expect(a[0]!.start).toBe(T0);
    expect(a[0]!.end).toBeNull();
  });

  it("coming back after the gap starts a new session", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + 5 * M, "B");
    cont(s, T0 + 30 * M, "A");
    expect(live(s, "A")).toHaveLength(2);
  });
});

describe("merge", () => {
  it("combines sessions: earliest start, latest end, notes joined, empty ones skipped", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0 + M, `A@${T0}`, "checked logs");
    startNew(s, T0 + H, "B");
    cont(s, T0 + 2 * H, "A"); // empty: continuation
    startNew(s, T0 + 3 * H, "C");
    cont(s, T0 + 4 * H, "A");
    note(s, T0 + 4 * H + M, `A@${T0 + 4 * H}`, "replaced cable");
    stop(s, T0 + 5 * H);
    run(s, T0 + 6 * H, {
      type: "session.merge",
      sessionIds: [`A@${T0}`, `A@${T0 + 2 * H}`, `A@${T0 + 4 * H}`],
    });
    const a = live(s, "A");
    expect(a).toHaveLength(1);
    expect([a[0]!.start, a[0]!.end]).toEqual([T0, T0 + 5 * H]);
    expect(a[0]!.notes).toBe("checked logs\nreplaced cable");
  });

  it("refuses to merge sessions of different tasks", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B");
    run(s, T0 + 2 * H, { type: "session.merge", sessionIds: [`A@${T0}`, `B@${T0 + H}`] });
    expect(live(s, "A")).toHaveLength(1);
    expect(live(s, "B")).toHaveLength(1);
  });
});

describe("settings", () => {
  const set = (s: State, patch: { blipSec?: number; resumeGapMin?: number }) =>
    run(s, T0 - H, { type: "settings.update", patch });

  it("blip discard can be turned off", () => {
    const s = emptyState();
    set(s, { blipSec: 0 });
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B");
    cont(s, T0 + 2 * H, "A");
    startNew(s, T0 + 2 * H + 5 * S, "C");
    expect(live(s, "A")).toHaveLength(2);
  });

  it("resume gap follows the setting, and 0 turns it off", () => {
    const s = emptyState();
    set(s, { resumeGapMin: 0 });
    startNew(s, T0, "A");
    startNew(s, T0 + 5 * M, "B");
    cont(s, T0 + 6 * M, "A");
    expect(live(s, "A")).toHaveLength(2);

    const s2 = emptyState();
    set(s2, { resumeGapMin: 30 });
    startNew(s2, T0, "A");
    startNew(s2, T0 + 5 * M, "B");
    cont(s2, T0 + 25 * M, "A");
    expect(live(s2, "A")).toHaveLength(1);
  });

  it("clamps bad values", () => {
    const s = emptyState();
    set(s, { blipSec: -5, resumeGapMin: 99999 });
    expect([s.settings!.blipSec, s.settings!.resumeGapMin]).toEqual([0, 240]);
  });
});

describe("pause", () => {
  const pause = (s: State, at: number, sessionId: string) => run(s, at, { type: "timer.pause", sessionId });
  const paused = (s: State) =>
    Object.values(s.tasks)
      .filter((t) => t.pausedAt)
      .map((t) => t.id)
      .sort();

  it("stops the clock but keeps the task paused", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    pause(s, T0 + H, `A@${T0}`);
    expect(span(s, `A@${T0}`)).toEqual([T0, T0 + H]);
    expect(paused(s)).toEqual(["A"]);
  });

  it("switching pauses what was running; alongside doesn't", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B");
    startNew(s, T0 + 2 * H, "C", "alongside");
    expect(paused(s)).toEqual(["A"]);
    expect(openTasks(s)).toEqual(["B", "C"]);
  });

  it("starting a paused task unpauses it (and resumes the same session within the gap)", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    pause(s, T0 + H, `A@${T0}`);
    cont(s, T0 + H + 5 * M, "A");
    expect(paused(s)).toEqual([]);
    expect(live(s, "A")).toHaveLength(1);
    expect(openTasks(s)).toEqual(["A"]);
  });

  it("stopping a paused task takes it off the stack", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B");
    run(s, T0 + 2 * H, { type: "timer.stop", taskId: "A" });
    expect(paused(s)).toEqual([]);
    expect(openTasks(s)).toEqual(["B"]);
  });

  it("pause all pauses everything running", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + M, "B", "alongside");
    run(s, T0 + H, { type: "timer.pause" });
    expect(openTasks(s)).toEqual([]);
    expect(paused(s)).toEqual(["A", "B"]);
    expect(span(s, `B@${T0 + M}`)).toEqual([T0 + M, T0 + H]);
  });

  it("stop all stops everything and clears paused tasks", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B");
    stop(s, T0 + 2 * H);
    expect(paused(s)).toEqual([]);
    expect(openTasks(s)).toEqual([]);
  });

  it("a late switch landing inside a finished session doesn't pause that task", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    run(s, T0 + 2 * H, { type: "timer.stop", taskId: "A" });
    startNew(s, T0 + H, "B"); // arrives late from the phone
    expect(paused(s)).toEqual([]);
  });
});

describe("entered elsewhere", () => {
  const enter = (s: State, at: number, sessionId: string) =>
    run(s, at, { type: "session.update", sessionId, patch: { enteredAt: at } });

  it("coming back within the gap doesn't reopen a session already entered", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B");
    enter(s, T0 + H + M, `A@${T0}`);
    cont(s, T0 + H + 5 * M, "A");
    const a = live(s, "A");
    expect(a).toHaveLength(2);
    expect(a[0]!.end).toBe(T0 + H);
  });

  it("a merge only counts as entered if every part was", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B");
    cont(s, T0 + 2 * H, "A");
    stop(s, T0 + 3 * H);
    enter(s, T0 + 4 * H, `A@${T0}`);
    run(s, T0 + 5 * H, { type: "session.merge", sessionIds: [`A@${T0}`, `A@${T0 + 2 * H}`] });
    expect(live(s, "A")[0]!.enteredAt).toBeNull();
  });
});

describe("editing", () => {
  const enter = (s: State, at: number, sessionId: string) =>
    run(s, at, { type: "session.update", sessionId, patch: { enteredAt: at } });

  it("editing an entered session puts it back to enter, flagged; re-marking clears the flag", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    stop(s, T0 + H);
    enter(s, T0 + 2 * H, `A@${T0}`);
    run(s, T0 + 3 * H, { type: "session.update", sessionId: `A@${T0}`, patch: { start: T0 - 15 * M } });
    const a = s.sessions[`A@${T0}`]!;
    expect([a.start, a.enteredAt, a.changedSinceEntered]).toEqual([T0 - 15 * M, null, true]);
    enter(s, T0 + 4 * H, `A@${T0}`);
    expect(s.sessions[`A@${T0}`]!.changedSinceEntered).toBe(false);
  });

  it("re-saving the same value doesn't count as a change", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    stop(s, T0 + H);
    enter(s, T0 + 2 * H, `A@${T0}`);
    run(s, T0 + 3 * H, { type: "session.update", sessionId: `A@${T0}`, patch: { start: T0 } });
    expect(s.sessions[`A@${T0}`]!.enteredAt).toBe(T0 + 2 * H);
  });

  it("adds a manual session with the task's work type", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    run(s, T0 + M, { type: "session.update", sessionId: `A@${T0}`, patch: { fields: { workType: "remote" } } });
    stop(s, T0 + H);
    run(s, T0 + 5 * H, { type: "session.create", sessionId: "m1", taskId: "A", start: T0 + 2 * H, end: T0 + 3 * H });
    expect(live(s, "A")).toHaveLength(2);
    expect(s.sessions.m1!.fields.workType).toBe("remote");
  });

  it("refuses a manual session that ends before it starts", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    run(s, T0 + H, { type: "session.create", sessionId: "m1", taskId: "A", start: T0 + H, end: T0 });
    expect(s.sessions.m1).toBeUndefined();
  });

  it("deletes and undeletes a session", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    stop(s, T0 + H);
    run(s, T0 + 2 * H, { type: "session.delete", sessionId: `A@${T0}` });
    expect(live(s, "A")).toHaveLength(0);
    run(s, T0 + 2 * H, { type: "session.delete", sessionId: `A@${T0}`, undo: true });
    expect(live(s, "A")).toHaveLength(1);
  });

  it("undoing the delete of a running session can't give a task two open sessions", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    run(s, T0 + H, { type: "session.delete", sessionId: `A@${T0}` });
    cont(s, T0 + 2 * H, "A");
    run(s, T0 + 3 * H, { type: "session.delete", sessionId: `A@${T0}`, undo: true });
    expect(openSessions(s).filter((x) => x.taskId === "A")).toHaveLength(1);
  });
});

describe("late ops (phone was offline)", () => {
  it("a late switch lands between the sessions around it", () => {
    const s = emptyState();
    startNew(s, T0, "A"); // desktop 8:00
    startNew(s, T0 + 2 * H, "C"); // desktop 10:00
    startNew(s, T0 + H, "B"); // phone 9:00, arrives late
    expect(span(s, `A@${T0}`)).toEqual([T0, T0 + H]);
    expect(span(s, `B@${T0 + H}`)).toEqual([T0 + H, T0 + 2 * H]);
    expect(openTasks(s)).toEqual(["C"]);
  });

  it("a late switch during a pause runs until the next start", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    stop(s, T0 + H);
    startNew(s, T0 + 3 * H, "C");
    startNew(s, T0 + 2 * H, "B"); // late
    expect(span(s, `B@${T0 + 2 * H}`)).toEqual([T0 + 2 * H, T0 + 3 * H]);
    expect(openTasks(s)).toEqual(["C"]);
  });

  it("a late switch inside a later-paused session keeps the pause time", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    stop(s, T0 + 2 * H);
    startNew(s, T0 + H, "B"); // late
    expect(span(s, `A@${T0}`)).toEqual([T0, T0 + H]);
    expect(span(s, `B@${T0 + H}`)).toEqual([T0 + H, T0 + 2 * H]);
    expect(openTasks(s)).toEqual([]);
  });
});

describe("new entry (fresh start)", () => {
  const fresh = (s: State, at: number, taskId: string, sessionFields?: Record<string, string>) =>
    run(s, at, { type: "task.start", taskId, sessionId: `${taskId}@${at}`, mode: "alongside", fresh: true, sessionFields });
  const workType = (s: State, at: number, sessionId: string, workType: string) =>
    run(s, at, { type: "session.update", sessionId, patch: { fields: { workType } } });

  it("ends the running session and starts a new one at the same moment, with the new work type", () => {
    const s = emptyState();
    run(s, T0, { type: "list.create", itemId: "onsite", list: "workTypes", name: "Onsite" });
    run(s, T0, { type: "list.update", itemId: "onsite", patch: { defaults: { billing: "Billable" } } });
    startNew(s, T0, "A");
    workType(s, T0, `A@${T0}`, "travel");
    run(s, T0, { type: "session.update", sessionId: `A@${T0}`, patch: { fields: { billing: "Do Not Bill", noteTo: "Internal" } } });
    fresh(s, T0 + 30 * M, "A", { workType: "onsite" });
    expect(span(s, `A@${T0}`)).toEqual([T0, T0 + 30 * M]);
    expect(span(s, `A@${T0 + 30 * M}`)).toEqual([T0 + 30 * M, null]);
    expect(s.sessions[`A@${T0}`]!.fields.workType).toBe("travel");
    // The work type's billing comes with it; the rest carries over.
    expect(s.sessions[`A@${T0 + 30 * M}`]!.fields).toEqual({ workType: "onsite", billing: "Billable", noteTo: "Internal" });
    expect(s.sessions[`A@${T0 + 30 * M}`]!.notes).toBe("");
  });

  it("leaves other running tasks alone", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0, "B", "alongside");
    fresh(s, T0 + H, "A");
    expect(openTasks(s)).toEqual(["A", "B"]);
    expect(span(s, `B@${T0}`)).toEqual([T0, null]);
  });

  it("doesn't reopen a session within the resume gap", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    workType(s, T0, `A@${T0}`, "comms");
    run(s, T0 + 10 * M, { type: "timer.pause", sessionId: `A@${T0}` });
    fresh(s, T0 + 12 * M, "A", { workType: "remote" });
    expect(span(s, `A@${T0}`)).toEqual([T0, T0 + 10 * M]);
    expect(span(s, `A@${T0 + 12 * M}`)).toEqual([T0 + 12 * M, null]);
    expect(s.tasks.A!.pausedAt ?? null).toBeNull();
  });

  it("splitting off a blip discards it, even when it was the task's only session", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    workType(s, T0, `A@${T0}`, "travel");
    fresh(s, T0 + 10 * S, "A", { workType: "onsite" });
    expect(live(s, "A").map((x) => x.id)).toEqual([`A@${T0 + 10 * S}`]);
  });

  it("the next entry carries over a discarded blip's fields, not older ones", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    workType(s, T0, `A@${T0}`, "travel");
    fresh(s, T0 + H, "A", { workType: "onsite" });
    workType(s, T0 + H + 5 * S, `A@${T0 + H}`, "remote"); // changed its mind
    fresh(s, T0 + H + 10 * S, "A");
    expect(live(s, "A").map((x) => [x.id, x.fields.workType])).toEqual([
      [`A@${T0}`, "travel"],
      [`A@${T0 + H + 10 * S}`, "remote"],
    ]);
  });

  it("arriving late inside a session that has since ended, it ends where that one did", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    stop(s, T0 + 2 * H);
    fresh(s, T0 + H, "A"); // the phone, offline
    expect(span(s, `A@${T0}`)).toEqual([T0, T0 + H]);
    expect(span(s, `A@${T0 + H}`)).toEqual([T0 + H, T0 + 2 * H]);
    expect(openTasks(s)).toEqual([]);
  });

  it("is safe to apply twice", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    fresh(s, T0 + H, "A");
    fresh(s, T0 + H, "A");
    expect(live(s, "A").map((x) => span(s, x.id))).toEqual([
      [T0, T0 + H],
      [T0 + H, null],
    ]);
  });
});

describe("titles", () => {
  it("uses the first line of the notes until the task is named", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0 + M, `A@${T0}`, "\n- Acme printer offline\n- rebooted spooler");
    expect(displayTitle(s.tasks.A!, live(s, "A"))).toEqual({ text: "Acme printer offline", derived: true });
    run(s, T0 + 2 * M, { type: "task.update", taskId: "A", patch: { title: "Printer" } });
    expect(displayTitle(s.tasks.A!, live(s, "A")).text).toBe("Printer");
  });

  it("strips list and checkbox markers", () => {
    expect(firstLine("  * [ ] call ISP")).toBe("call ISP");
    expect(firstLine("## Heading")).toBe("Heading");
    expect(firstLine("1. first")).toBe("first");
  });
});

describe("ticket lookup", () => {
  const info = { summary: "Printer offline", company: "Acme", closed: false, fetchedAt: T0 };
  const withTask = (title = "") => {
    const s = emptyState();
    run(s, T0, { type: "list.create", itemId: "acme", list: "clients", name: "Acme" });
    run(s, T0, { type: "task.create", taskId: "A", title });
    run(s, T0, { type: "task.update", taskId: "A", patch: { fields: { ticket: "#123 " } } });
    return s;
  };
  const lookup = (s: State, ref: string, fill: Record<string, string> = { client: "acme" }) =>
    run(s, T0 + M, { type: "task.refInfo", taskId: "A", field: "ticket", ref, info, fill });

  it("fills an untitled task's title and client", () => {
    const s = withTask();
    lookup(s, "123");
    expect(s.tasks.A).toMatchObject({ refInfo: { ...info, field: "ticket", ref: "123" }, title: "Printer offline" });
    expect(s.tasks.A!.fields).toEqual({ ticket: "#123 ", client: "acme" });
  });

  it("a refresh (keepTitle) keeps a title renamed since, but follows a renamed ticket", () => {
    const s = withTask();
    lookup(s, "123");
    run(s, T0 + 2 * M, { type: "task.update", taskId: "A", patch: { title: "Printer offline at FD2" } });
    const refresh = (summary: string) =>
      run(s, T0 + 3 * M, { type: "task.refInfo", taskId: "A", field: "ticket", ref: "123", info: { ...info, summary }, keepTitle: true });
    refresh("Printer offline (CW)");
    expect(s.tasks.A).toMatchObject({ title: "Printer offline at FD2", refInfo: { summary: "Printer offline (CW)" } });
    run(s, T0 + 4 * M, { type: "task.update", taskId: "A", patch: { title: "Printer offline (CW)" } });
    refresh("Printer replaced");
    expect(s.tasks.A!.title).toBe("Printer replaced");
  });

  it("replaces the title with the ticket's summary, but never a client set meanwhile", () => {
    const s = withTask("My title");
    run(s, T0, { type: "task.update", taskId: "A", patch: { fields: { client: "other" } } });
    lookup(s, "123");
    expect(s.tasks.A).toMatchObject({ title: "Printer offline", fields: { client: "other" } });
  });

  it("ignores a lookup for a ticket # that has since changed", () => {
    const s = withTask();
    run(s, T0, { type: "task.update", taskId: "A", patch: { fields: { ticket: "456" } } });
    lookup(s, "123");
    expect(s.tasks.A!.refInfo ?? null).toBeNull();
    expect(s.tasks.A!.title).toBe("");
  });

  it("clears the info when the ticket # changes, but not when only its formatting does", () => {
    const s = withTask();
    lookup(s, "123");
    run(s, T0 + 2 * M, { type: "task.update", taskId: "A", patch: { fields: { ticket: "123" } } });
    expect(s.tasks.A!.refInfo?.ref).toBe("123");
    run(s, T0 + 2 * M, { type: "task.update", taskId: "A", patch: { fields: { client: null } } });
    expect(s.tasks.A!.refInfo?.ref).toBe("123");
    run(s, T0 + 3 * M, { type: "task.update", taskId: "A", patch: { fields: { ticket: "124" } } });
    expect(s.tasks.A!.refInfo).toBeNull();
  });

  it("is safe to apply twice", () => {
    const s = withTask();
    lookup(s, "123", {});
    lookup(s, "123", {});
    expect(s.tasks.A).toMatchObject({ title: "Printer offline", fields: { ticket: "#123 " } });
  });
});

describe("fields", () => {
  it("merges a patch key by key; null, empty and false clear a key", () => {
    const s = emptyState();
    run(s, T0, { type: "task.create", taskId: "A", title: "a", fields: { client: "acme", ticket: "" } });
    expect(s.tasks.A!.fields).toEqual({ client: "acme" });
    run(s, T0, { type: "task.update", taskId: "A", patch: { fields: { ticket: "5", urgent: true } } });
    run(s, T0, { type: "task.update", taskId: "A", patch: { fields: { client: null, urgent: false } } });
    expect(s.tasks.A!.fields).toEqual({ ticket: "5" });
  });

  it("a new session inherits each field from the latest earlier session that has it", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    run(s, T0 + M, { type: "session.update", sessionId: `A@${T0}`, patch: { fields: { workType: "remote", billing: "No Charge" } } });
    stop(s, T0 + H);
    cont(s, T0 + 2 * H, "A");
    run(s, T0 + 2 * H + M, { type: "session.update", sessionId: `A@${T0 + 2 * H}`, patch: { fields: { workType: "onsite" } } });
    stop(s, T0 + 3 * H);
    cont(s, T0 + 4 * H, "A");
    expect(s.sessions[`A@${T0 + 4 * H}`]!.fields).toEqual({ workType: "onsite", billing: "No Charge" });
  });

  it("changing a field of an entered session flags it; setting the same value doesn't", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    stop(s, T0 + H);
    const id = `A@${T0}`;
    run(s, T0 + H, { type: "session.update", sessionId: id, patch: { fields: { workType: "remote" }, enteredAt: T0 + H } });
    run(s, T0 + 2 * H, { type: "session.update", sessionId: id, patch: { fields: { workType: "remote" } } });
    expect(s.sessions[id]).toMatchObject({ enteredAt: T0 + H, changedSinceEntered: false });
    run(s, T0 + 2 * H, { type: "session.update", sessionId: id, patch: { fields: { workType: "onsite" } } });
    expect(s.sessions[id]).toMatchObject({ enteredAt: null, changedSinceEntered: true });
  });

  it("a merge takes each field from the earliest part that has it", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    stop(s, T0 + H);
    cont(s, T0 + 2 * H, "A");
    stop(s, T0 + 3 * H);
    run(s, T0 + 3 * H, { type: "session.update", sessionId: `A@${T0}`, patch: { fields: { workType: "remote" } } });
    run(s, T0 + 3 * H, { type: "session.update", sessionId: `A@${T0 + 2 * H}`, patch: { fields: { workType: "onsite", billing: "Billable" } } });
    run(s, T0 + 4 * H, { type: "session.merge", sessionIds: [`A@${T0}`, `A@${T0 + 2 * H}`] });
    expect(s.sessions[`A@${T0}`]!.fields).toEqual({ workType: "remote", billing: "Billable" });
  });

  it("list items get the next position in their own list", () => {
    const s = emptyState();
    run(s, T0, { type: "list.create", itemId: "a", list: "workTypes", name: "A" });
    run(s, T0, { type: "list.create", itemId: "x", list: "clients", name: "X" });
    run(s, T0, { type: "list.create", itemId: "b", list: "workTypes", name: "B" });
    expect([s.lists.a!.position, s.lists.x!.position, s.lists.b!.position]).toEqual([0, 0, 1]);
  });

  it("links a list item to an external record and unlinks it", () => {
    const s = emptyState();
    run(s, T0, { type: "list.create", itemId: "z", list: "clients", name: "Zen", ext: { cw: { companyId: 19304 } } });
    expect(s.lists.z!.ext).toEqual({ cw: { companyId: 19304 } });
    run(s, T0 + M, { type: "list.update", itemId: "x", patch: { ext: { cw: { companyId: 1 } } } });
    run(s, T0 + M, { type: "list.update", itemId: "z", patch: { name: "Zen Dental", ext: { cw: { companyId: 19650 } } } });
    expect(s.lists.z).toMatchObject({ name: "Zen Dental", ext: { cw: { companyId: 19650 } } });
    run(s, T0 + 2 * M, { type: "list.update", itemId: "z", patch: { ext: { cw: { companyId: null } } } });
    expect(s.lists.z!.ext).toEqual({});
  });
});

describe("ops queued before profiles", () => {
  // Shapes an old app version may still have in its outbox (migration 8).
  const legacy = (s: State, at: number, op: object) => run(s, at, op as Op);

  it("maps client, ticket # and work type onto the CW profile's fields", () => {
    const s = emptyState();
    legacy(s, T0, { type: "group.create", groupId: "acme", name: "Acme" });
    legacy(s, T0, { type: "task.create", taskId: "A", title: "a", groupId: "acme" });
    legacy(s, T0, { type: "task.start", taskId: "B", sessionId: "b1", newTask: { title: "", groupId: null } });
    legacy(s, T0 + M, { type: "task.update", taskId: "B", patch: { groupId: "acme", ref: "77", title: "b" } });
    legacy(s, T0 + M, { type: "session.update", sessionId: "b1", patch: { categoryId: "remote", notes: "x" } });
    legacy(s, T0 + 2 * M, { type: "group.update", groupId: "acme", patch: { name: "Acme Corp" } });
    expect(s.lists.acme).toMatchObject({ list: "clients", name: "Acme Corp" });
    expect(s.tasks.A!.fields).toEqual({ client: "acme" });
    expect(s.tasks.B).toMatchObject({ title: "b", fields: { client: "acme", ticket: "77" } });
    expect(s.sessions.b1).toMatchObject({ notes: "x", fields: { workType: "remote" } });
    legacy(s, T0 + 3 * M, { type: "task.update", taskId: "B", patch: { groupId: null } });
    expect(s.tasks.B!.fields).toEqual({ ticket: "77" });
  });

  it("a manual session's categoryId: undefined inherits, null means none", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    run(s, T0 + M, { type: "session.update", sessionId: `A@${T0}`, patch: { fields: { workType: "remote" } } });
    stop(s, T0 + H);
    legacy(s, T0 + 5 * H, { type: "session.create", sessionId: "m1", taskId: "A", start: T0 + 2 * H, end: T0 + 3 * H });
    legacy(s, T0 + 5 * H, { type: "session.create", sessionId: "m2", taskId: "A", start: T0 + 3 * H, end: T0 + 4 * H, categoryId: null });
    expect(s.sessions.m1!.fields).toEqual({ workType: "remote" });
    expect(s.sessions.m2!.fields).toEqual({});
  });

  it("an old ticket lookup fills the client only if it exists", () => {
    const s = emptyState();
    legacy(s, T0, { type: "group.create", groupId: "acme", name: "Acme" });
    legacy(s, T0, { type: "task.create", taskId: "A", title: "", groupId: null });
    legacy(s, T0, { type: "task.update", taskId: "A", patch: { ref: "123" } });
    const info = { summary: "Printer", company: "Acme", closed: false, fetchedAt: T0 };
    legacy(s, T0 + M, { type: "task.refInfo", taskId: "A", ref: "123", info, groupId: "nope" });
    expect(s.tasks.A!.fields).toEqual({ ticket: "123" });
    legacy(s, T0 + M, { type: "task.update", taskId: "A", patch: { title: "" } });
    legacy(s, T0 + M, { type: "task.refInfo", taskId: "A", ref: "123", info, groupId: "acme" });
    expect(s.tasks.A).toMatchObject({ title: "Printer", fields: { ticket: "123", client: "acme" }, refInfo: { field: "ticket", ref: "123" } });
  });
});

describe("projects", () => {
  const project = (s: State, projectId: string, parentId: string | null = null) =>
    run(s, T0, { type: "project.create", projectId, title: projectId, parentId });
  const reparent = (s: State, projectId: string, parentId: string | null) =>
    run(s, T0 + M, { type: "project.update", projectId, patch: { parentId } });

  it("nests to any depth and lists in tree order", () => {
    const s = emptyState();
    project(s, "Acme");
    project(s, "Firewall", "Acme");
    project(s, "Cutover", "Firewall");
    project(s, "Beta");
    expect(projectPath(s, "Cutover").map((p) => p.id)).toEqual(["Acme", "Firewall", "Cutover"]);
    const tree = projectTree(Object.values(s.projects)).map((x) => `${x.depth}${x.project.id}`);
    expect(tree).toEqual(["0Acme", "1Firewall", "2Cutover", "0Beta"]);
  });

  it("never puts a project inside itself or its own descendants", () => {
    const s = emptyState();
    project(s, "Acme");
    project(s, "Firewall", "Acme");
    reparent(s, "Acme", "Acme");
    reparent(s, "Acme", "Firewall");
    expect(s.projects.Acme!.parentId).toBeNull();
    reparent(s, "Firewall", null);
    reparent(s, "Acme", "Firewall");
    expect(s.projects.Acme!.parentId).toBe("Firewall");
  });

  it("ignores an unknown parent, but still applies the rest of the patch", () => {
    const s = emptyState();
    project(s, "Acme");
    run(s, T0 + M, { type: "project.update", projectId: "Acme", patch: { parentId: "nope", title: "Acme Corp" } });
    expect(s.projects.Acme).toMatchObject({ parentId: null, title: "Acme Corp" });
  });

  it("puts tasks in a project when created, started or edited; an unknown project means none", () => {
    const s = emptyState();
    project(s, "Acme");
    run(s, T0, { type: "task.create", taskId: "A", title: "a", projectId: "Acme" });
    run(s, T0, { type: "task.start", taskId: "B", sessionId: "b1", newTask: { title: "", projectId: "Acme" } });
    run(s, T0, { type: "task.create", taskId: "C", title: "c" });
    run(s, T0 + M, { type: "task.update", taskId: "C", patch: { projectId: "nope" } });
    expect([s.tasks.A!.projectId, s.tasks.B!.projectId, s.tasks.C!.projectId]).toEqual(["Acme", "Acme", null]);
    run(s, T0 + M, { type: "task.update", taskId: "C", patch: { projectId: "Acme" } });
    expect(s.tasks.C!.projectId).toBe("Acme");
  });

  it("creating the same project twice is harmless", () => {
    const s = emptyState();
    project(s, "Acme");
    run(s, T0 + M, { type: "project.update", projectId: "Acme", patch: { title: "Renamed" } });
    project(s, "Acme");
    expect(s.projects.Acme!.title).toBe("Renamed");
  });
});

describe("list item defaults", () => {
  // Work types carry a billing default, as in the CW profile.
  const withWorkTypes = () => {
    const s = emptyState();
    run(s, T0, { type: "list.create", itemId: "remote", list: "workTypes", name: "Remote" });
    run(s, T0, { type: "list.create", itemId: "travel", list: "workTypes", name: "Travel" });
    run(s, T0, { type: "list.update", itemId: "remote", patch: { defaults: { billing: "Billable" } } });
    run(s, T0, { type: "list.update", itemId: "travel", patch: { defaults: { billing: "Do Not Bill" } } });
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    return s;
  };
  const id = `A@${T0}`;

  it("choosing a work type sets its billing", () => {
    const s = withWorkTypes();
    run(s, T0 + M, { type: "session.update", sessionId: id, patch: { fields: { workType: "remote" } } });
    expect(s.sessions[id]!.fields).toEqual({ workType: "remote", billing: "Billable" });
    run(s, T0 + 2 * M, { type: "session.update", sessionId: id, patch: { fields: { workType: "travel" } } });
    expect(s.sessions[id]!.fields).toEqual({ workType: "travel", billing: "Do Not Bill" });
  });

  it("billing set in the same change wins, and can be changed on its own afterwards", () => {
    const s = withWorkTypes();
    run(s, T0 + M, { type: "session.update", sessionId: id, patch: { fields: { workType: "remote", billing: "No Charge" } } });
    expect(s.sessions[id]!.fields.billing).toBe("No Charge");
    run(s, T0 + 2 * M, { type: "session.update", sessionId: id, patch: { fields: { billing: "Do Not Bill" } } });
    expect(s.sessions[id]!.fields).toEqual({ workType: "remote", billing: "Do Not Bill" });
  });

  it("applies to manual sessions and to old queued categoryId changes", () => {
    const s = withWorkTypes();
    run(s, T0 + H, { type: "session.create", sessionId: "m1", taskId: "A", start: T0 - 2 * H, end: T0 - H, fields: { workType: "travel" } });
    expect(s.sessions.m1!.fields).toEqual({ workType: "travel", billing: "Do Not Bill" });
    run(s, T0 + H, { type: "session.update", sessionId: id, patch: { categoryId: "remote" } } as unknown as Op);
    expect(s.sessions[id]!.fields).toEqual({ workType: "remote", billing: "Billable" });
  });

  it("re-choosing the same work type on an entered session doesn't flag it", () => {
    const s = withWorkTypes();
    run(s, T0 + M, { type: "session.update", sessionId: id, patch: { fields: { workType: "remote" } } });
    stop(s, T0 + H);
    run(s, T0 + H, { type: "session.update", sessionId: id, patch: { enteredAt: T0 + H } });
    run(s, T0 + 2 * H, { type: "session.update", sessionId: id, patch: { fields: { workType: "remote" } } });
    expect(s.sessions[id]).toMatchObject({ enteredAt: T0 + H, changedSinceEntered: false });
  });
});

describe("integration data (ext)", () => {
  const pushed = (s: State, at: number, id: string, entryId: number) =>
    run(s, at, { type: "session.update", sessionId: id, patch: { ext: { cw: { entryId, pushedAt: at } }, enteredAt: at } });

  it("merges per integration, key by key; null removes a key", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    stop(s, T0 + H);
    const id = `A@${T0}`;
    run(s, T0 + H, { type: "session.update", sessionId: id, patch: { ext: { cw: { email: true } } } });
    pushed(s, T0 + 2 * H, id, 501);
    expect(s.sessions[id]!.ext).toEqual({ cw: { email: true, entryId: 501, pushedAt: T0 + 2 * H } });
    run(s, T0 + 3 * H, { type: "session.update", sessionId: id, patch: { ext: { cw: { email: null } } } });
    expect(s.sessions[id]!.ext).toEqual({ cw: { entryId: 501, pushedAt: T0 + 2 * H } });
  });

  it("changing it doesn't count as editing an entered session", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    stop(s, T0 + H);
    const id = `A@${T0}`;
    pushed(s, T0 + 2 * H, id, 501);
    run(s, T0 + 3 * H, { type: "session.update", sessionId: id, patch: { ext: { cw: { email: true } } } });
    expect(s.sessions[id]).toMatchObject({ enteredAt: T0 + 2 * H, changedSinceEntered: false });
    // Editing the times after a push flags it, and keeps the CW id for the update.
    run(s, T0 + 4 * H, { type: "session.update", sessionId: id, patch: { end: T0 + 30 * M } });
    expect(s.sessions[id]).toMatchObject({ enteredAt: null, changedSinceEntered: true, ext: { cw: { entryId: 501 } } });
  });

  it("isn't copied to the task's next session (unlike fields)", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    run(s, T0 + M, { type: "session.update", sessionId: `A@${T0}`, patch: { ext: { cw: { email: true } } } });
    stop(s, T0 + H);
    cont(s, T0 + 2 * H, "A");
    expect(s.sessions[`A@${T0 + 2 * H}`]!.ext).toBeUndefined();
  });
});

describe("deleting a task", () => {
  it("takes its sessions with it, stops it, and undo brings back only those", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "work"); // a new task stopped with no notes would be dropped
    stop(s, T0 + H);
    cont(s, T0 + 2 * H, "A");
    run(s, T0 + 3 * H, { type: "timer.pause" });
    const [first, second] = live(s, "A");
    // Deleted on its own before the task was.
    note(s, T0 + 3 * H, first!.id, "keep me");
    run(s, T0 + 3 * H, { type: "session.delete", sessionId: first!.id });

    run(s, T0 + 4 * H, { type: "task.delete", taskId: "A" });
    expect(s.tasks.A).toMatchObject({ deleted: true, pausedAt: null });
    expect(live(s, "A")).toEqual([]);
    expect(s.sessions[second!.id]).toMatchObject({ deleted: true, deletedWithTask: true });
    expect(s.sessions[first!.id]!.deletedWithTask).toBeFalsy();

    run(s, T0 + 5 * H, { type: "task.delete", taskId: "A", undo: true });
    expect(s.tasks.A!.deleted).toBe(false);
    expect(live(s, "A").map((x) => x.id)).toEqual([second!.id]);
  });

  it("ends a running session, and nothing starts or adds time on a deleted task", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    run(s, T0 + H, { type: "task.delete", taskId: "A" });
    expect(openTasks(s)).toEqual([]);
    cont(s, T0 + 2 * H, "A");
    run(s, T0 + 2 * H, { type: "session.create", sessionId: "late", taskId: "A", start: T0, end: T0 + M });
    expect(openTasks(s)).toEqual([]);
    expect(s.sessions.late).toBeUndefined();
  });
});

describe("notes as plain text", () => {
  it("drops Markdown, keeps lines, names images and files", () => {
    expect(plainNote("**Action Taken:**\n- Signed in to *3CX*\n- Called \(twice\) ++today++")).toBe("Action Taken:\n- Signed in to 3CX\n- Called (twice) today");
    expect(plainNote("See ![](/api/files/abc/screen%20shot.png) and [the log](/api/files/def/log.txt) or [docs](https://x.y)")).toBe(
      "See [screen shot.png] and [the log] or docs",
    );
    expect(firstLine("**Printer** offline\nmore")).toBe("Printer offline");
    expect(plainNote("2 * 3 * 4")).toBe("2 * 3 * 4");
  });
});

describe("dropping an empty new task", () => {
  it("a new task stopped with no notes goes, however long it ran", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    stop(s, T0 + 2 * H);
    expect(s.tasks.A!.deleted).toBe(true);
    expect(live(s, "A")).toHaveLength(0);
  });

  it("stop all drops it too, paused or running", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    startNew(s, T0 + H, "B"); // switching pauses A; that alone doesn't drop it
    expect(s.tasks.A!.deleted).toBeFalsy();
    stop(s, T0 + 2 * H);
    expect([s.tasks.A!.deleted, s.tasks.B!.deleted]).toEqual([true, true]);
  });

  it("pausing doesn't drop it", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    run(s, T0 + H, { type: "timer.pause" });
    expect(s.tasks.A!.deleted).toBeFalsy();
    expect(s.tasks.A!.pausedAt).toBe(T0 + H);
  });

  it("keeps it with notes, a description, or more than one session", () => {
    const s = emptyState();
    startNew(s, T0, "A");
    note(s, T0, `A@${T0}`, "did a thing");
    startNew(s, T0 + H, "B");
    run(s, T0 + H, { type: "task.update", taskId: "B", patch: { description: "plan" } });
    startNew(s, T0 + 2 * H, "C");
    note(s, T0 + 2 * H, `C@${T0 + 2 * H}`, "first");
    stop(s, T0 + 3 * H);
    cont(s, T0 + 5 * H, "C");
    stop(s, T0 + 6 * H);
    expect([s.tasks.A!.deleted, s.tasks.B!.deleted, s.tasks.C!.deleted]).toEqual([undefined, undefined, undefined]);
  });

  it("keeps a task made beforehand (Inbox), even when its start is moved earlier for a new one", () => {
    const s = emptyState();
    run(s, T0, { type: "task.create", taskId: "A", title: "Planned" });
    cont(s, T0 + H, "A");
    stop(s, T0 + 2 * H);
    expect(s.tasks.A!.deleted).toBeFalsy();
    startNew(s, T0 + 3 * H, "B");
    run(s, T0 + 3 * H, { type: "session.update", sessionId: `B@${T0 + 3 * H}`, patch: { start: T0 + 150 * M } });
    stop(s, T0 + 4 * H);
    expect(s.tasks.B!.deleted).toBe(true);
  });
});

describe("moving a session (▶ WRIT on the running card)", () => {
  it("moves the running session and drops the empty task it came from", () => {
    const s = emptyState();
    startNew(s, T0, "W");
    note(s, T0, `W@${T0}`, "timesheet");
    run(s, T0, { type: "session.update", sessionId: `W@${T0}`, patch: { fields: { workType: "admin", billing: "No Charge" } } });
    stop(s, T0 + H);
    startNew(s, T0 + 2 * H, "A");
    run(s, T0 + 2 * H, { type: "session.update", sessionId: `A@${T0 + 2 * H}`, patch: { notes: "emails", fields: { workType: "remote" } } });
    run(s, T0 + 2 * H + M, { type: "session.move", sessionId: `A@${T0 + 2 * H}`, taskId: "W" });
    const moved = s.sessions[`A@${T0 + 2 * H}`]!;
    expect(moved).toMatchObject({ taskId: "W", end: null, notes: "emails", fields: { workType: "remote", billing: "No Charge" } });
    expect(s.tasks.A!.deleted).toBe(true);
    expect(moved.deleted).toBe(false);
    expect(openTasks(s)).toEqual(["W"]);
  });

  it("keeps the old task if it has other time", () => {
    const s = emptyState();
    startNew(s, T0, "W");
    note(s, T0, `W@${T0}`, "x");
    stop(s, T0 + H);
    startNew(s, T0 + 2 * H, "A");
    note(s, T0 + 2 * H, `A@${T0 + 2 * H}`, "x");
    stop(s, T0 + 3 * H);
    cont(s, T0 + 5 * H, "A");
    run(s, T0 + 5 * H + M, { type: "session.move", sessionId: `A@${T0 + 5 * H}`, taskId: "W" });
    expect(s.tasks.A!.deleted).toBeFalsy();
    expect(live(s, "A")).toHaveLength(1);
  });

  it("won't give a task two open sessions", () => {
    const s = emptyState();
    startNew(s, T0, "W");
    startNew(s, T0 + H, "A", "alongside");
    run(s, T0 + 2 * H, { type: "session.move", sessionId: `A@${T0 + H}`, taskId: "W" });
    expect(s.sessions[`A@${T0 + H}`]!.taskId).toBe("A");
  });
});
