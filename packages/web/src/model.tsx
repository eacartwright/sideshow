import {
  displayTitle,
  durationMs,
  firstLine,
  isInbox,
  lastTouchedAt,
  newId,
  openSessions,
  overlapMs,
  projectPath,
  projectTree,
  sessionsByTask,
  settingsOf,
  startOfDay,
  ticketNumber,
  type FieldDef,
  type Fields,
  type FieldValue,
  type Id,
  type ListItem,
  type Project,
  type Profile,
  type ProjectPatch,
  type Session,
  type SessionPatch,
  type Settings,
  type State,
  type Task,
  type TaskPatch,
} from "@sideshow/shared";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, SignedOut, sync, type Snapshot } from "./sync";
import { showToast } from "./toast";

// Everything the UI reads (derived from the synced state) and every action it can take.

export interface TaskInfo {
  task: Task;
  sessions: Session[];
  title: string;
  titleDerived: boolean;
  /** What the Title field shows: the title, else the notes' first line in full; "" if neither. */
  titleText: string;
  /** The value of the profile's groupBy field (the client). */
  groupItem: ListItem | undefined;
  /** Task field values as shown ("#106745", "Acme"), in profile order. */
  fieldTexts: string[];
  project: Project | undefined;
  /** The project and the ones it sits in, "Acme › Firewall"; "" for none. */
  projectPath: string;
  lastTouched: number;
  inbox: boolean;
  /** Lowercased text searched by the switcher. */
  haystack: string;
}

export interface Model extends Snapshot {
  tasks: Map<Id, TaskInfo>;
  /** Every task, archived too, most recently touched first. */
  all: TaskInfo[];
  /** Non-archived tasks, most recently touched first. */
  recent: TaskInfo[];
  /** Running sessions, the one most recently started on this device first. */
  running: Session[];
  /** Paused tasks (clock stopped, still on the Now stack), most recently paused first. */
  paused: TaskInfo[];
  profile: Profile;
  /** Each list's items that aren't archived, in order. */
  lists: Map<string, ListItem[]>;
  /** The field tasks are grouped by (the client), if the profile has one. */
  groupBy: FieldDef | undefined;
  /** Projects that aren't archived, in tree order. */
  projects: ProjectInfo[];
  settings: Settings;
}

/** What happened to one session in a push to ConnectWise (the server's PushResult). */
export interface PushResult {
  sessionId: Id;
  ok: boolean;
  action?: "created" | "updated";
  entryId?: number;
  error?: string;
}

export interface ProjectInfo {
  project: Project;
  depth: number;
  /** "Acme › Firewall". */
  path: string;
}

export const pathText = (projects: Project[]) => projects.map((p) => p.title || "Untitled").join(" › ");

/** A field's value as shown: a list item's name, a ticket # with its "#", a bool's label. "" if unset. */
export function fieldText(def: FieldDef, value: FieldValue | undefined, state: State): string {
  if (value === undefined || value === "" || value === false) return "";
  if (def.type === "bool") return def.label;
  if (def.type === "list") return state.lists[String(value)]?.name ?? "";
  const text = String(value).trim();
  if (!def.prefix) return text;
  return def.prefix + text.replace(new RegExp(`^(${def.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})+\\s*`), "");
}

/** A session's field values as shown ("Remote - Business Hours"), in profile order. */
export function sessionFieldTexts(m: Model, s: Session): string[] {
  return m.profile.fields
    .filter((d) => d.on === "session")
    .map((d) => fieldText(d, s.fields[d.key], m.view))
    .filter(Boolean);
}

/** A text field's value without its prefix ("#106745 " → "106745"), for copying. */
export function bareText(def: FieldDef, value: FieldValue | undefined): string {
  const shown = fieldText(def, value, { lists: {} } as unknown as State);
  return def.prefix && shown.startsWith(def.prefix) ? shown.slice(def.prefix.length) : shown;
}

// Task ids in the order they were started on this device, most recent first.
// Decides which running card is on top (and so which notes field gets focus).
const activation: Id[] = [];
function activate(taskId: Id) {
  const i = activation.indexOf(taskId);
  if (i >= 0) activation.splice(i, 1);
  activation.unshift(taskId);
}

function listsOf(v: State): Map<string, ListItem[]> {
  const out = new Map<string, ListItem[]>();
  for (const item of Object.values(v.lists)) {
    if (item.archived) continue;
    out.set(item.list, [...(out.get(item.list) ?? []), item]);
  }
  for (const items of out.values()) items.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  return out;
}

function derive(snap: Snapshot): Model {
  const v: State = snap.view;
  const profile = snap.config.profile;
  const taskDefs = profile.fields.filter((f) => f.on === "task");
  const groupBy = profile.fields.find((f) => f.groupBy && f.type === "list");
  const byTask = sessionsByTask(v);
  const tasks = new Map<Id, TaskInfo>();
  for (const task of Object.values(v.tasks)) {
    const sessions = byTask.get(task.id) ?? [];
    const { text, derived } = displayTitle(task, sessions);
    const fields: Fields = task.fields ?? {};
    const fieldTexts = taskDefs.map((d) => fieldText(d, fields[d.key], v)).filter(Boolean);
    const groupValue = groupBy ? fields[groupBy.key] : undefined;
    const path = projectPath(v, task.projectId);
    const projectText = pathText(path);
    tasks.set(task.id, {
      task,
      sessions,
      title: text,
      titleDerived: derived,
      titleText: task.title.trim() || firstLine(sessions.find((s) => firstLine(s.notes))?.notes ?? "", Infinity),
      groupItem: groupValue ? v.lists[String(groupValue)] : undefined,
      fieldTexts,
      project: path[path.length - 1],
      projectPath: projectText,
      lastTouched: lastTouchedAt(task, sessions),
      inbox: isInbox(task, sessions),
      haystack: [text, task.title, ...fieldTexts, projectText, task.description, ...sessions.map((s) => s.notes)]
        .filter(Boolean)
        .join("\n")
        .toLowerCase(),
    });
  }
  const all = [...tasks.values()].sort((a, b) => b.lastTouched - a.lastTouched);
  const recent = all.filter((t) => t.task.status !== "archived");
  const rank = (s: Session) => {
    const i = activation.indexOf(s.taskId);
    return i < 0 ? Infinity : i;
  };
  const running = openSessions(v).sort((a, b) => rank(a) - rank(b) || b.start - a.start);
  const runningIds = new Set(running.map((s) => s.taskId));
  const paused = [...tasks.values()]
    .filter((t) => t.task.pausedAt && !runningIds.has(t.task.id))
    .sort((a, b) => b.task.pausedAt! - a.task.pausedAt!);
  return {
    ...snap,
    tasks,
    all,
    recent,
    running,
    paused,
    profile,
    lists: listsOf(v),
    groupBy,
    projects: projectTree(Object.values(v.projects).filter((p) => p.status !== "archived")).map(({ project, depth }) => ({
      project,
      depth,
      path: pathText(projectPath(v, project.id)),
    })),
    settings: settingsOf(v),
  };
}

export function useModel(): Model {
  const snap = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  return useMemo(() => derive(snap), [snap]);
}

/** A task's total time, and its time on `day` (default today). */
export function taskTotals(info: TaskInfo, now: number, day = startOfDay(now)) {
  const dayEnd = startOfDay(day + 36 * 3_600_000); // the next day's start, even across DST
  let total = 0;
  let onDay = 0;
  for (const s of info.sessions) {
    total += durationMs(s, now);
    onDay += overlapMs(s, day, dayEnd, now);
  }
  return { total, onDay };
}

/** Re-render every `ms` milliseconds (for live timers). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// ---- actions ----

export interface Actions {
  /** ▶ New. `alongside` keeps whatever is running going. Returns the new session id. */
  startNew(title?: string, alongside?: boolean, projectId?: Id | null): Id | undefined;
  /** ▶ on an existing task. */
  continueTask(taskId: Id, alongside?: boolean): void;
  /** Stop the clock but keep the task on the Now stack; everything running if none given. */
  pause(sessionId?: Id): void;
  /** Stop a task (its running session, if any) and take it off the Now stack; everything if none given. */
  stop(target?: { sessionId?: Id; taskId?: Id }): void;
  addInbox(title: string, projectId: Id | null, fields?: Fields): void;
  updateTask(taskId: Id, patch: TaskPatch): void;
  /** Set (or with null, clear) one of a task's fields. */
  setTaskField(taskId: Id, key: string, value: FieldValue | null): void;
  /** Fetch the CW ticket behind the task's ticket field and record it. Resolves to an error message, or null. */
  lookupTicket(taskId: Id): Promise<string | null>;
  /** Ask CW which of these pushed sessions' entries were deleted there (they go back to To enter). Resolves to how many, or null if CW couldn't be asked. */
  checkCw(sessionIds: Id[]): Promise<number | null>;
  /** Push sessions to CW as time entries: each one's result, or why the whole push failed. */
  pushToCw(sessionIds: Id[]): Promise<{ results: PushResult[] } | { error: string }>;
  updateSession(sessionId: Id, patch: SessionPatch): void;
  setSessionField(sessionId: Id, key: string, value: FieldValue | null): void;
  mergeSessions(sessionIds: Id[]): void;
  /** Add time after the fact. Returns the new session id. */
  createSession(taskId: Id, start: number, end: number): Id;
  /** A new task with one session over a span (the calendar's drag-to-add). Returns the session id. */
  createTaskWithSession(title: string, start: number, end: number): Id;
  /** Delete a session, with an Undo toast. */
  deleteSession(sessionId: Id): void;
  /** Add an item to one of the profile's lists (a new client). */
  createListItem(list: string, name: string): Id;
  createProject(title: string, parentId: Id | null): Id;
  updateProject(projectId: Id, patch: ProjectPatch): void;
  updateSettings(patch: { blipSec?: number; resumeGapMin?: number }): void;
  /** The top running card's notes field. */
  notesRef: React.RefObject<HTMLTextAreaElement | null>;
}

const coarse = () => window.matchMedia("(pointer: coarse)").matches;

export function useActionsFactory(): Actions {
  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  return useMemo<Actions>(() => {
    // The started task always lands in the top card, whose textarea stays mounted.
    // Focusing it synchronously inside the tap is what lets iOS raise the keyboard.
    const focusNotes = (force: boolean) => {
      const el = notesRef.current;
      if (!el) return;
      if (force || !coarse()) el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    return {
      notesRef,
      startNew(title = "", alongside = false, projectId = null) {
        const taskId = newId();
        const sessionId = newId();
        activate(taskId);
        focusNotes(true);
        sync.dispatch({
          type: "task.start",
          taskId,
          sessionId,
          newTask: { title, projectId },
          mode: alongside ? "alongside" : "switch",
        });
        return sessionId;
      },
      continueTask(taskId, alongside = false) {
        activate(taskId);
        focusNotes(false);
        sync.dispatch({ type: "task.start", taskId, sessionId: newId(), mode: alongside ? "alongside" : "switch" });
      },
      pause(sessionId) {
        sync.dispatch({ type: "timer.pause", sessionId });
      },
      stop(target) {
        sync.dispatch({ type: "timer.stop", ...target });
      },
      addInbox(title, projectId, fields = {}) {
        sync.dispatch({ type: "task.create", taskId: newId(), title, projectId, fields });
      },
      updateTask(taskId, patch) {
        sync.dispatch({ type: "task.update", taskId, patch }, 600);
      },
      setTaskField(taskId, key, value) {
        sync.dispatch({ type: "task.update", taskId, patch: { fields: { [key]: value } } }, 600);
      },
      async lookupTicket(taskId) {
        const snap = sync.getSnapshot();
        const cw = snap.config.profile.connectwise;
        const task = snap.view.tasks[taskId];
        const n = task && cw ? ticketNumber(String(task.fields[cw.ticketField] ?? "")) : "";
        if (!cw || !n) return null;
        try {
          const res = await api(`/api/cw/tickets/${n}`);
          const t = (await res.json()) as { summary: string; company: string; closed: boolean };
          // The CW company becomes the client if a client of the same name exists.
          const fill: Fields = {};
          const clientDef = snap.config.profile.fields.find((f) => f.key === cw.clientField);
          if (clientDef?.list) {
            const name = t.company.trim().toLowerCase();
            const item = Object.values(sync.getSnapshot().view.lists).find(
              (x) => x.list === clientDef.list && !x.archived && x.name.trim().toLowerCase() === name,
            );
            if (item) fill[clientDef.key] = item.id;
          }
          sync.dispatch({
            type: "task.refInfo",
            taskId,
            field: cw.ticketField,
            ref: n,
            info: { summary: t.summary, company: t.company, closed: t.closed, fetchedAt: Date.now() },
            fill,
          });
          return null;
        } catch (err) {
          if (err instanceof SignedOut) return "Signed out: reload to sign in";
          const status = (err as Error).message;
          if (status === "404") return `No ticket #${n}`;
          if (status === "503") return "ConnectWise isn't set up on the server";
          return "Couldn't look it up";
        }
      },
      async checkCw(sessionIds) {
        try {
          const res = await api("/api/cw/check", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionIds }),
          });
          const { removed } = (await res.json()) as { removed: Id[] };
          if (removed.length) {
            showToast(
              removed.length === 1
                ? "1 entry was deleted in ConnectWise: it's back on To enter"
                : `${removed.length} entries were deleted in ConnectWise: they're back on To enter`,
            );
          }
          return removed.length;
        } catch {
          return null;
        }
      },
      async pushToCw(sessionIds) {
        // The server pushes what it has: first make sure it has every edit made here.
        if (!(await sync.sendNow())) return { error: "Couldn't send your latest changes to the server first. Check the connection and try again." };
        try {
          const res = await api("/api/cw/push", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionIds }),
          });
          return (await res.json()) as { results: PushResult[] };
        } catch (err) {
          if (err instanceof SignedOut) return { error: "Signed out: reload to sign in, then push again." };
          const status = (err as Error).message;
          if (status === "503") return { error: "Pushing isn't set up on the server (CW_MEMBER in .env)." };
          return { error: "Couldn't reach ConnectWise. Nothing was pushed; try again." };
        }
      },
      updateSession(sessionId, patch) {
        sync.dispatch({ type: "session.update", sessionId, patch }, 800);
      },
      setSessionField(sessionId, key, value) {
        sync.dispatch({ type: "session.update", sessionId, patch: { fields: { [key]: value } } }, 800);
      },
      mergeSessions(sessionIds) {
        sync.dispatch({ type: "session.merge", sessionIds });
      },
      createSession(taskId, start, end) {
        const sessionId = newId();
        sync.dispatch({ type: "session.create", sessionId, taskId, start, end });
        return sessionId;
      },
      createTaskWithSession(title, start, end) {
        const taskId = newId();
        const sessionId = newId();
        sync.dispatch({ type: "task.create", taskId, title: title.trim(), projectId: null });
        sync.dispatch({ type: "session.create", sessionId, taskId, start, end });
        return sessionId;
      },
      deleteSession(sessionId) {
        sync.dispatch({ type: "session.delete", sessionId });
        showToast("Session deleted", {
          label: "Undo",
          run: () => sync.dispatch({ type: "session.delete", sessionId, undo: true }),
        });
      },
      createListItem(list, name) {
        const itemId = newId();
        sync.dispatch({ type: "list.create", itemId, list, name: name.trim() });
        return itemId;
      },
      createProject(title, parentId) {
        const projectId = newId();
        sync.dispatch({ type: "project.create", projectId, title: title.trim(), parentId });
        return projectId;
      },
      updateProject(projectId, patch) {
        sync.dispatch({ type: "project.update", projectId, patch }, 600);
      },
      updateSettings(patch) {
        sync.dispatch({ type: "settings.update", patch });
      },
    };
  }, []);
}

export const ModelContext = createContext<Model | null>(null);
export const ActionsContext = createContext<Actions | null>(null);

export const useM = () => useContext(ModelContext)!;
export const useA = () => useContext(ActionsContext)!;
