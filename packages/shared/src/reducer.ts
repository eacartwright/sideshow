import { ticketNumber } from "./derive";
import type { Op, OpEnvelope } from "./ops";
import { settingsOf, type Changes, type Ext, type ExtPatch, type Fields, type FieldsPatch, type Id, type Ms, type Session, type State } from "./types";

// The single reducer used by both client (optimistic) and server (authoritative).
// It mutates `state` in place and records which entities it touched.
//
// Rules:
// - Several tasks may run at once, but each task has at most one open session.
// - Starting in "switch" mode pauses everything else; "alongside" leaves it running.
// - Paused tasks (clock stopped) stay on the Now stack until stopped or started again.
// - Coming back to a task within settings.resumeGapMin of its last session reopens
//   that session instead of adding a new fragment.
// - A session under settings.blipSec with no notes is discarded when it ends,
//   unless it's the task's only session.
//
// Start/stop use timeline semantics (what was running *at the op's time*), so an
// op that reaches the server late because the phone had no signal still lands
// where it happened.

export interface Touched {
  lists: Set<Id>;
  projects: Set<Id>;
  tasks: Set<Id>;
  sessions: Set<Id>;
  settings: boolean;
}

export function newTouched(): Touched {
  return { lists: new Set(), projects: new Set(), tasks: new Set(), sessions: new Set(), settings: false };
}

export function collectChanges(state: State, t: Touched): Changes {
  const pick = <T>(rec: Record<Id, T>, ids: Set<Id>) =>
    [...ids].map((id) => rec[id]).filter((x): x is T => x !== undefined);
  return {
    lists: pick(state.lists, t.lists),
    projects: pick(state.projects, t.projects),
    tasks: pick(state.tasks, t.tasks),
    sessions: pick(state.sessions, t.sessions),
    settings: t.settings ? settingsOf(state) : null,
  };
}

export function liveSessions(state: State): Session[] {
  return Object.values(state.sessions).filter((s) => !s.deleted);
}

/** Sessions whose time range covers `t` (start inclusive, end exclusive). */
export function sessionsAt(state: State, t: Ms): Session[] {
  return liveSessions(state).filter((s) => s.start <= t && (s.end === null || s.end > t));
}

export function openSessions(state: State): Session[] {
  return liveSessions(state).filter((s) => s.end === null);
}

function taskSessions(state: State, taskId: Id): Session[] {
  return liveSessions(state)
    .filter((s) => s.taskId === taskId)
    .sort((a, b) => a.start - b.start);
}

function nextStartAfter(state: State, t: Ms): Ms | null {
  let next: Ms | null = null;
  for (const s of liveSessions(state)) {
    if (s.start > t && (next === null || s.start < next)) next = s.start;
  }
  return next;
}

/** Session fields (work type…) carry over from the task's earlier sessions: each from the latest that has it. */
function inheritedFields(state: State, taskId: Id, before: Ms): Fields {
  const out: Fields = {};
  for (const s of taskSessions(state, taskId)) {
    if (s.start < before) Object.assign(out, s.fields);
  }
  return out;
}

const unset = (v: unknown) => v === null || v === undefined || v === "" || v === false;

/** Merge integration data key by key (null removes a key; an integration with no keys left goes). */
function patchExt(ext: Ext | undefined, patch: ExtPatch): Ext {
  const out: Ext = structuredClone(ext ?? {});
  for (const [name, keys] of Object.entries(patch)) {
    if (!keys || typeof keys !== "object") continue;
    const into = { ...out[name] };
    for (const [k, v] of Object.entries(keys)) {
      if (v === null || v === undefined) delete into[k];
      else if (["string", "number", "boolean"].includes(typeof v)) into[k] = v;
    }
    if (Object.keys(into).length) out[name] = into;
    else delete out[name];
  }
  return out;
}

/** Fields with the unset ones dropped. */
function cleanFields(fields: FieldsPatch | undefined): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields ?? {})) if (!unset(v)) out[k] = v!;
  return out;
}

/** Merge a patch into fields: null, "" or false clears a key. Returns whether anything changed. */
function patchFields(fields: Fields, patch: FieldsPatch): boolean {
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (unset(v)) {
      if (k in fields) {
        delete fields[k];
        changed = true;
      }
    } else if (fields[k] !== v) {
      fields[k] = v!;
      changed = true;
    }
  }
  return changed;
}

/**
 * Apply a fields patch, then the defaults of any list item it picks (a work type brings its
 * billing), except for keys the patch sets itself. Returns whether anything changed.
 */
function setFields(state: State, fields: Fields, patch: FieldsPatch): boolean {
  const before = JSON.stringify(Object.entries(fields).sort());
  patchFields(fields, patch);
  for (const v of Object.values(patch)) {
    const defaults = typeof v === "string" ? state.lists[v]?.defaults : null;
    if (!defaults) continue;
    const rest: FieldsPatch = {};
    for (const [k, d] of Object.entries(defaults)) if (!(k in patch)) rest[k] = d;
    patchFields(fields, rest);
  }
  return JSON.stringify(Object.entries(fields).sort()) !== before;
}

/** New fields from a patch, with list item defaults (see setFields). */
function newFields(state: State, patch: FieldsPatch | undefined): Fields {
  const fields: Fields = {};
  setFields(state, fields, patch ?? {});
  return fields;
}

/**
 * Ops queued before profiles (migration 8) use groupId (client), ref (ticket #) and
 * categoryId (work type), and group.* for the client list. Map them onto the CW profile's
 * field keys, which is what migration 8 moved the stored values to.
 */
export const LEGACY_KEYS = { group: "client", ref: "ticket", category: "workType", groupList: "clients" } as const;

function upgradeOp(state: State, raw: Op): Op {
  const op = raw as any;
  const K = LEGACY_KEYS;
  const legacyTask = (x: any): FieldsPatch => {
    const f: FieldsPatch = {};
    if ("groupId" in x) f[K.group] = x.groupId;
    if ("ref" in x) f[K.ref] = x.ref;
    return f;
  };
  switch (op.type) {
    case "group.create":
      return { type: "list.create", itemId: op.groupId, list: K.groupList, name: op.name };
    case "group.update":
      return { type: "list.update", itemId: op.groupId, patch: op.patch };
    case "task.start":
      if (op.newTask && "groupId" in op.newTask) {
        const { groupId: _, ...rest } = op.newTask;
        return { ...op, newTask: { ...rest, fields: cleanFields(legacyTask(op.newTask)) } };
      }
      return op;
    case "task.create":
      if ("groupId" in op) {
        const { groupId: _, ...rest } = op;
        return { ...rest, fields: cleanFields(legacyTask(op)) };
      }
      return op;
    case "task.update":
      if ("groupId" in op.patch || "ref" in op.patch) {
        const { groupId: _g, ref: _r, ...rest } = op.patch;
        return { ...op, patch: { ...rest, fields: { ...rest.fields, ...legacyTask(op.patch) } } };
      }
      return op;
    case "task.refInfo":
      if (!("field" in op)) {
        const { groupId, ...rest } = op;
        const fill = groupId && state.lists[groupId] ? { [K.group]: groupId } : undefined;
        return { ...rest, field: K.ref, fill };
      }
      return op;
    case "session.update":
      if ("categoryId" in op.patch) {
        const { categoryId, ...rest } = op.patch;
        return { ...op, patch: { ...rest, fields: { ...rest.fields, [K.category]: categoryId } } };
      }
      return op;
    case "session.create":
      if ("categoryId" in op) {
        const { categoryId, ...rest } = op;
        // undefined meant "inherit", null meant "none".
        return categoryId === undefined ? rest : { ...rest, fields: cleanFields({ [K.category]: categoryId }) };
      }
      return op;
  }
  return op;
}

/** The project id if that project exists, otherwise null (no project). */
function knownProject(state: State, id: Id | null | undefined): Id | null {
  return id && state.projects[id] ? id : null;
}

/** Whether `parentId` may hold `projectId`: it exists and isn't the project or one of its descendants. */
function canNest(state: State, projectId: Id, parentId: Id | null): boolean {
  const seen = new Set<Id>();
  for (let p = parentId; p !== null; p = state.projects[p]!.parentId) {
    if (p === projectId || seen.has(p) || !state.projects[p]) return false;
    seen.add(p);
  }
  return true;
}

function setPaused(state: State, taskId: Id, pausedAt: Ms | null, at: Ms, t: Touched) {
  const task = state.tasks[taskId];
  if (!task || (task.pausedAt ?? null) === pausedAt) return;
  task.pausedAt = pausedAt;
  task.updatedAt = at;
  t.tasks.add(taskId);
}

function endSession(state: State, s: Session, at: Ms, t: Touched) {
  s.end = Math.max(at, s.start);
  s.updatedAt = at;
  t.sessions.add(s.id);
  // Discard blips: a few seconds on a task that already has other time, with nothing written.
  const blipMs = settingsOf(state).blipSec * 1000;
  if (s.end - s.start < blipMs && !s.notes.trim() && taskSessions(state, s.taskId).length > 1) {
    s.deleted = true;
  }
}

export function applyOp(state: State, env: OpEnvelope, t: Touched = newTouched()): Touched {
  const at = env.at;
  const op = upgradeOp(state, env.op);

  switch (op.type) {
    case "task.start": {
      if (state.sessions[op.sessionId]) break; // already applied

      let task = state.tasks[op.taskId];
      if (!task) {
        if (!op.newTask) break; // continuing a task we don't know about
        task = {
          id: op.taskId,
          title: op.newTask.title,
          projectId: knownProject(state, op.newTask.projectId),
          fields: newFields(state, op.newTask.fields),
          description: "",
          status: "open",
          createdAt: at,
          updatedAt: at,
          rev: 0,
        };
        state.tasks[task.id] = task;
        t.tasks.add(task.id);
      } else if (task.status !== "open") {
        task.status = "open";
        task.updatedAt = at;
        t.tasks.add(task.id);
      }
      const taskId = task.id;
      setPaused(state, taskId, null, at, t);

      const covering = sessionsAt(state, at);
      const others = covering.filter((s) => s.taskId !== taskId);
      const mode = op.mode ?? "switch";

      // How long the new stretch runs. Normally until stopped (null). For a late
      // switch, until whatever it interrupted would have ended, or until the next thing started.
      let end: Ms | null = null;
      if (mode === "switch") {
        if (others.length) end = others.some((s) => s.end === null) ? null : Math.max(...others.map((s) => s.end!));
        else end = nextStartAfter(state, at);
        for (const s of others) {
          // Switching away pauses: it stays on screen. (A late switch landing inside a
          // session that has since ended doesn't resurrect that task.)
          if (s.end === null) setPaused(state, s.taskId, at, at, t);
          endSession(state, s, at, t);
        }
      }
      if (covering.some((s) => s.taskId === taskId)) break; // already running then

      const own = taskSessions(state, taskId);
      const laterOwn = own.find((s) => s.start > at);
      if (laterOwn && (end === null || end > laterOwn.start)) end = laterOwn.start;

      // Back on it shortly after stopping: keep going in the same session
      // (unless it's already been entered elsewhere; that entry shouldn't change under you).
      const prev = [...own].reverse().find((s) => s.start <= at);
      if (prev && prev.end !== null && !prev.enteredAt && at - prev.end <= settingsOf(state).resumeGapMin * 60_000) {
        prev.end = end;
        prev.updatedAt = at;
        t.sessions.add(prev.id);
        break;
      }

      state.sessions[op.sessionId] = {
        id: op.sessionId,
        taskId,
        start: at,
        end,
        deductMin: 0,
        notes: "",
        fields: inheritedFields(state, taskId, at),
        deleted: false,
        updatedAt: at,
        rev: 0,
      };
      t.sessions.add(op.sessionId);
      break;
    }

    case "timer.stop": {
      if (op.sessionId || op.taskId) {
        const s = op.sessionId ? state.sessions[op.sessionId] : undefined;
        if (s && !s.deleted && s.start <= at && (s.end === null || s.end > at)) endSession(state, s, at, t);
        if (op.taskId) {
          for (const o of sessionsAt(state, at)) if (o.taskId === op.taskId) endSession(state, o, at, t);
        }
        const taskId = op.taskId ?? s?.taskId;
        if (taskId) setPaused(state, taskId, null, at, t);
      } else {
        for (const s of sessionsAt(state, at)) endSession(state, s, at, t);
        for (const task of Object.values(state.tasks)) if (task.pausedAt) setPaused(state, task.id, null, at, t);
      }
      break;
    }

    case "timer.pause": {
      const targets = op.sessionId ? [state.sessions[op.sessionId]] : openSessions(state);
      for (const s of targets) {
        if (!s || s.deleted || s.end !== null || s.start > at) continue;
        setPaused(state, s.taskId, at, at, t);
        endSession(state, s, at, t);
      }
      break;
    }

    case "task.create": {
      if (state.tasks[op.taskId]) break;
      state.tasks[op.taskId] = {
        id: op.taskId,
        title: op.title,
        projectId: knownProject(state, op.projectId),
        fields: newFields(state, op.fields),
        description: "",
        status: "open",
        createdAt: at,
        updatedAt: at,
        rev: 0,
      };
      t.tasks.add(op.taskId);
      break;
    }

    case "task.update": {
      const task = state.tasks[op.taskId];
      if (!task) break;
      const { fields, ...patch } = op.patch;
      if (fields) {
        // Ticket info describes the old number, so it goes when that field changes to another.
        const info = task.refInfo;
        if (info && info.field in fields && ticketNumber(String(fields[info.field] ?? "")) !== info.ref) task.refInfo = null;
        task.fields ??= {};
        setFields(state, task.fields, fields);
      }
      if (patch.projectId !== undefined) patch.projectId = knownProject(state, patch.projectId);
      Object.assign(task, patch, { updatedAt: at });
      t.tasks.add(task.id);
      // Finishing or archiving a task stops its clock and takes it off the Now stack.
      if (patch.status && patch.status !== "open") {
        setPaused(state, task.id, null, at, t);
        for (const s of openSessions(state)) if (s.taskId === task.id) endSession(state, s, at, t);
      }
      break;
    }

    case "task.refInfo": {
      const task = state.tasks[op.taskId];
      const n = ticketNumber(op.ref);
      // A lookup that finishes after the field was changed (here or on another device) is stale.
      if (!task || !n || ticketNumber(String(task.fields[op.field] ?? "")) !== n) break;
      task.refInfo = { ...op.info, field: op.field, ref: n };
      // A linked ticket names the task: its summary replaces the title. Other fields (the
      // client) are only filled while empty, so one set meanwhile is never replaced.
      if (op.info.summary.trim()) task.title = op.info.summary.trim();
      for (const [k, v] of Object.entries(op.fill ?? {})) if (!(k in task.fields) && !unset(v)) task.fields[k] = v;
      task.updatedAt = at;
      t.tasks.add(task.id);
      break;
    }

    case "session.update": {
      const s = state.sessions[op.sessionId];
      if (!s || s.deleted) break;
      const { fields, ext, ...patch } = op.patch;
      // Editing what was already entered elsewhere puts it back on the to-enter list, flagged.
      const content = ["start", "end", "notes", "deductMin"] as const;
      const changed =
        content.some((k) => k in patch && patch[k] !== s[k]) ||
        (!!fields && setFields(state, structuredClone(s.fields), fields));
      if (patch.enteredAt) s.changedSinceEntered = false;
      else if (s.enteredAt && changed && !("enteredAt" in patch)) {
        patch.enteredAt = null;
        s.changedSinceEntered = true;
      }
      // Never give a task two open sessions.
      if (patch.end === null && s.end !== null && openSessions(state).some((o) => o.taskId === s.taskId)) {
        delete patch.end;
      }
      if (fields) setFields(state, s.fields, fields);
      if (ext) s.ext = patchExt(s.ext, ext);
      Object.assign(s, patch, { updatedAt: at });
      if (s.end !== null && s.end < s.start) s.end = s.start;
      t.sessions.add(s.id);
      break;
    }

    case "session.create": {
      if (state.sessions[op.sessionId] || !state.tasks[op.taskId]) break;
      if (!(op.end > op.start)) break;
      state.sessions[op.sessionId] = {
        id: op.sessionId,
        taskId: op.taskId,
        start: op.start,
        end: op.end,
        deductMin: 0,
        notes: op.notes ?? "",
        fields: op.fields !== undefined ? newFields(state, op.fields) : inheritedFields(state, op.taskId, op.start),
        deleted: false,
        updatedAt: at,
        rev: 0,
      };
      t.sessions.add(op.sessionId);
      break;
    }

    case "session.delete": {
      const s = state.sessions[op.sessionId];
      if (!s || !!s.deleted === !op.undo) break;
      // Bringing back a running session while the task has started another: close it now.
      if (op.undo && s.end === null && openSessions(state).some((o) => o.taskId === s.taskId)) s.end = Math.max(at, s.start);
      s.deleted = !op.undo;
      s.updatedAt = at;
      t.sessions.add(s.id);
      break;
    }

    case "session.merge": {
      const list = op.sessionIds
        .map((id) => state.sessions[id])
        .filter((s): s is Session => !!s && !s.deleted)
        .sort((a, b) => a.start - b.start);
      if (list.length < 2 || list.some((s) => s.taskId !== list[0]!.taskId)) break;
      const [target, ...rest] = list as [Session, ...Session[]];
      target.end = list.some((s) => s.end === null) ? null : Math.max(...list.map((s) => s.end!));
      // Empty notes are "continuation of previous work": nothing to carry over.
      target.notes = list
        .map((s) => s.notes.trim())
        .filter(Boolean)
        .join("\n");
      target.deductMin = list.reduce((sum, s) => sum + s.deductMin, 0);
      // Each field from the earliest part that has it.
      target.fields = Object.assign({}, ...[...list].reverse().map((s) => s.fields));
      // The merged session is a different entry; it only counts as entered if every part was.
      const allEntered = list.every((s) => s.enteredAt);
      target.enteredAt = allEntered ? Math.max(...list.map((s) => s.enteredAt!)) : null;
      target.changedSinceEntered = !allEntered && list.some((s) => s.enteredAt || s.changedSinceEntered);
      target.updatedAt = at;
      t.sessions.add(target.id);
      for (const s of rest) {
        s.deleted = true;
        s.updatedAt = at;
        t.sessions.add(s.id);
      }
      break;
    }

    case "list.create": {
      if (state.lists[op.itemId]) break;
      const last = Math.max(-1, ...Object.values(state.lists).filter((x) => x.list === op.list).map((x) => x.position));
      state.lists[op.itemId] = {
        id: op.itemId,
        list: op.list,
        name: op.name,
        position: last + 1,
        archived: false,
        defaults: null,
        createdAt: at,
        updatedAt: at,
        rev: 0,
      };
      t.lists.add(op.itemId);
      break;
    }

    case "list.update": {
      const item = state.lists[op.itemId];
      if (!item) break;
      Object.assign(item, op.patch, { updatedAt: at });
      t.lists.add(item.id);
      break;
    }

    case "project.create": {
      if (state.projects[op.projectId]) break;
      state.projects[op.projectId] = {
        id: op.projectId,
        title: op.title,
        parentId: knownProject(state, op.parentId),
        description: "",
        status: "open",
        createdAt: at,
        updatedAt: at,
        rev: 0,
      };
      t.projects.add(op.projectId);
      break;
    }

    case "project.update": {
      const p = state.projects[op.projectId];
      if (!p) break;
      const patch = { ...op.patch };
      if (patch.parentId !== undefined && !canNest(state, p.id, patch.parentId)) delete patch.parentId;
      Object.assign(p, patch, { updatedAt: at });
      t.projects.add(p.id);
      break;
    }

    case "settings.update": {
      const next = { ...settingsOf(state) };
      const clamp = (v: unknown, max: number) =>
        typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(0, Math.round(v)), max) : undefined;
      const blip = clamp(op.patch.blipSec, 600);
      const gap = clamp(op.patch.resumeGapMin, 240);
      if (blip !== undefined) next.blipSec = blip;
      if (gap !== undefined) next.resumeGapMin = gap;
      state.settings = next;
      t.settings = true;
      break;
    }
  }
  return t;
}
