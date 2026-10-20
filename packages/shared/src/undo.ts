import type { Op, OpEnvelope, ProjectPatch, SessionPatch, TaskPatch } from "./ops";
import { applyOp, newTouched } from "./reducer";
import type { Fields, FieldsPatch, State } from "./types";

// Undo (DESIGN.md §7, "Undo"): the ops that put back what some ops changed. Worked out from the
// state before them, so it covers any op without each needing its own inverse: apply the ops to
// a copy, then for every record they touched, emit ops that restore it, applying each to the
// copy as it goes so later ones see what earlier ones did (a move back, then the fields).
//
// What ops can't express isn't restored: the clock (a stopped session isn't restarted, a paused
// task isn't paused again), ticket lookups (they're fetched again), integration data (`ext`:
// a push can't be undone here), and new list items or projects (they stay, unused).

/** A fields patch that makes `now` equal `was`: every key of `was`, and null for the rest. */
function restoreFields(was: Fields, now: Fields): FieldsPatch | null {
  const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
  if ([...keys].every((k) => was[k] === now[k])) return null;
  // Every key of `was`, not only the changed ones: a list item it sets (a work type) would
  // otherwise bring its defaults (billing) over a value that was kept.
  const patch: FieldsPatch = { ...was };
  for (const k of keys) if (!(k in was)) patch[k] = null;
  return patch;
}

export function undoOps(before: State, ops: OpEnvelope[], at: number): Op[] {
  const work = structuredClone(before);
  const t = newTouched();
  for (const env of ops) applyOp(work, env, t);
  const out: Op[] = [];
  let n = 0;
  const emit = (op: Op) => {
    out.push(op);
    applyOp(work, { id: `undo${n++}`, at, op });
  };

  // Deleted tasks first: their sessions come back with them, and can then be moved or fixed.
  for (const id of t.tasks) {
    const b = before.tasks[id];
    if (b && !b.deleted && work.tasks[id]?.deleted) emit({ type: "task.delete", taskId: id, undo: true });
  }

  for (const id of t.sessions) {
    const b = before.sessions[id];
    const w = work.sessions[id];
    if (!w) continue;
    if (!b || b.deleted) {
      if (!w.deleted) emit({ type: "session.delete", sessionId: id });
      continue;
    }
    if (w.deleted) emit({ type: "session.delete", sessionId: id, undo: true });
    if (work.sessions[id]!.taskId !== b.taskId) emit({ type: "session.move", sessionId: id, taskId: b.taskId });
    const s = work.sessions[id]!;
    const patch: SessionPatch = {};
    for (const k of ["start", "end", "notes", "deductMin"] as const) {
      if (b[k] !== s[k]) (patch as Record<string, unknown>)[k] = b[k];
    }
    const fields = restoreFields(b.fields, s.fields);
    if (fields) patch.fields = fields;
    const was = b.enteredAt ?? null;
    // Restoring an entered session's content would take it off "entered": say it still is.
    if (was !== (s.enteredAt ?? null) || (was && Object.keys(patch).length)) patch.enteredAt = was;
    if (Object.keys(patch).length) emit({ type: "session.update", sessionId: id, patch });
  }

  for (const id of t.tasks) {
    const b = before.tasks[id];
    const w = work.tasks[id];
    if (!w) continue;
    if (!b) {
      // Made by these ops.
      if (!w.deleted) emit({ type: "task.delete", taskId: id });
      continue;
    }
    if (b.deleted && !w.deleted) {
      emit({ type: "task.delete", taskId: id });
      continue;
    }
    const patch: TaskPatch = {};
    if (b.title !== w.title) patch.title = b.title;
    if ((b.projectId ?? null) !== (w.projectId ?? null)) patch.projectId = b.projectId ?? null;
    if (b.description !== w.description) patch.description = b.description;
    if (b.status !== w.status) patch.status = b.status;
    const fields = restoreFields(b.fields, w.fields);
    if (fields) patch.fields = fields;
    if (Object.keys(patch).length) emit({ type: "task.update", taskId: id, patch });
  }

  for (const id of t.lists) {
    const b = before.lists[id];
    const w = work.lists[id];
    if (!b || !w) continue;
    const patch: { name?: string; archived?: boolean; defaults?: Fields | null } = {};
    if (b.name !== w.name) patch.name = b.name;
    if (b.archived !== w.archived) patch.archived = b.archived;
    if (JSON.stringify(b.defaults ?? null) !== JSON.stringify(w.defaults ?? null)) patch.defaults = b.defaults ?? null;
    if (Object.keys(patch).length) emit({ type: "list.update", itemId: id, patch });
  }

  for (const id of t.projects) {
    const b = before.projects[id];
    const w = work.projects[id];
    if (!b || !w) continue;
    const patch: ProjectPatch = {};
    if (b.title !== w.title) patch.title = b.title;
    if (b.parentId !== w.parentId) patch.parentId = b.parentId;
    if (b.description !== w.description) patch.description = b.description;
    if (b.status !== w.status) patch.status = b.status;
    if (Object.keys(patch).length) emit({ type: "project.update", projectId: id, patch });
  }
  return out;
}
