import {
  companyKey,
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
  type FieldsPatch,
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
import { getWeekly, refreshWeekly } from "./weekly";
import { send, undoable } from "./undo";

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

/** A CW service board a new ticket can go on (the server's BoardChoice). */
export interface CwBoard {
  id: number;
  name: string;
  types: { id: number; name: string; default: boolean }[];
  statuses: { id: number; name: string; default: boolean }[];
}

/** What a new CW ticket is made with (the server's NewTicket). */
export interface NewCwTicket {
  taskId: Id;
  summary: string;
  boardId: number;
  typeId?: number;
  statusId?: number;
  assign: boolean;
  description?: string;
  /** The task's sessions to push to the new ticket once it's made. */
  pushSessionIds?: Id[];
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
    if (task.deleted) continue;
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
  /**
   * ▶ WRIT: this week's recurring internal ticket. Continues its task, or starts one with the
   * ticket # (the lookup then fills the title and client). Focuses the notes, like ▶ New.
   */
  startWeekly(alongside?: boolean): void;
  /**
   * WRIT on the running card: move this session to this week's WRIT task (made if there's none
   * yet). The task it was on goes if ▶ New made it just for this.
   */
  moveToWeekly(sessionId: Id): void;
  /** ▶ on an existing task. */
  continueTask(taskId: Id, alongside?: boolean): void;
  /** Stop the clock but keep the task on the Now stack; everything running if none given. */
  pause(sessionId?: Id): void;
  /**
   * End a running session now and start a new one on its task (travel ends, onsite begins),
   * with `fields` patched onto the carried-over ones. Returns the new session id.
   */
  newEntry(sessionId: Id, fields?: FieldsPatch): Id | undefined;
  /** Stop a task (its running session, if any) and take it off the Now stack; everything if none given. */
  stop(target?: { sessionId?: Id; taskId?: Id }): void;
  addInbox(title: string, projectId: Id | null, fields?: Fields): void;
  updateTask(taskId: Id, patch: TaskPatch): void;
  /** Set (or with null, clear) one of a task's fields. */
  setTaskField(taskId: Id, key: string, value: FieldValue | null): void;
  /** Fetch the CW ticket behind the task's ticket field and record it. Resolves to an error message, or null. */
  lookupTicket(taskId: Id, opts?: { keepTitle?: boolean }): Promise<string | null>;
  /** Ask CW which of these pushed sessions' entries were deleted there (they go back to To enter). Resolves to how many, or null if CW couldn't be asked. */
  checkCw(sessionIds: Id[]): Promise<number | null>;
  /** Write the task's title to its CW ticket as the summary. Resolves to an error message, or null. */
  updateTicketSummary(taskId: Id): Promise<string | null>;
  /** What a new CW ticket can be: boards, and who it's assigned to. */
  cwBoards(): Promise<{ boards: CwBoard[]; owner: { id: number; name: string } | null } | { error: string }>;
  /** Make a CW ticket for a task; the server puts its number on the task. */
  createCwTicket(t: NewCwTicket): Promise<{ ticketId: number; pushed?: PushResult[]; pushError?: string } | { error: string }>;
  /** Push sessions to CW as time entries: each one's result, or why the whole push failed. */
  pushToCw(sessionIds: Id[]): Promise<{ results: PushResult[] } | { error: string }>;
  updateSession(sessionId: Id, patch: SessionPatch): void;
  setSessionField(sessionId: Id, key: string, value: FieldValue | null): void;
  mergeSessions(sessionIds: Id[]): void;
  /**
   * Move a session to another task, or to a new one with this title (Move to…). Resolves to
   * false when it can't (a running session onto a task that's running too).
   */
  moveSession(sessionId: Id, to: Id | { title: string }): boolean;
  /** Add time after the fact. Returns the new session id. */
  createSession(taskId: Id, start: number, end: number): Id;
  /** A new task with one session over a span (the calendar's drag-to-add). Returns the session id. */
  createTaskWithSession(title: string, start: number, end: number): Id;
  /** Delete a session, with an Undo toast. */
  deleteSession(sessionId: Id): void;
  /** Delete a task and its sessions, with an Undo toast. */
  deleteTask(taskId: Id): void;
  /** Add an item to one of the profile's lists (a new client). */
  createListItem(list: string, name: string): Id;
  /**
   * The client for a CW company: the one linked to it, else an unlinked one of the same name
   * (which gets linked), else a new linked one. Archived ones come back. It takes the
   * company's CW name.
   */
  clientForCompany(list: string, company: { id: number; name: string }): Id;
  /** Take an item out of its list (archived, so records using it keep their value), with an Undo toast. */
  removeListItem(itemId: Id): void;
  restoreListItem(itemId: Id): void;
  createProject(title: string, parentId: Id | null): Id;
  updateProject(projectId: Id, patch: ProjectPatch): void;
  updateSettings(patch: { blipSec?: number; resumeGapMin?: number }): void;
  /** The top running card's notes field. */
  notesRef: React.RefObject<HTMLElement | null>;
}

const coarse = () => window.matchMedia("(pointer: coarse)").matches;

/** A profile field's label ("Work type"), for naming an undo step. */
const fieldLabel = (key: string) => sync.getSnapshot().config.profile.fields.find((f) => f.key === key)?.label ?? "Field";

/** Actions.clientForCompany. */
function clientFor(list: string, company: { id: number; name: string }): Id {
  const items = Object.values(sync.getSnapshot().view.lists).filter((x) => x.list === list);
  const live = (x: ListItem) => (x.archived ? 1 : 0);
  const linked = items.filter((x) => x.ext?.cw?.companyId === company.id).sort((a, b) => live(a) - live(b))[0];
  const named = items
    .filter((x) => !x.ext?.cw?.companyId && companyKey(x.name) === companyKey(company.name))
    .sort((a, b) => live(a) - live(b))[0];
  const item = linked ?? named;
  const name = company.name.trim();
  if (!item) {
    const itemId = newId();
    send({ type: "list.create", itemId, list, name, ext: { cw: { companyId: company.id } } });
    return itemId;
  }
  if (item !== linked || item.archived || item.name !== name) {
    send({ type: "list.update", itemId: item.id, patch: { name, archived: false, ext: { cw: { companyId: company.id } } } });
  }
  return item.id;
}

export function useActionsFactory(): Actions {
  const notesRef = useRef<HTMLElement | null>(null);

  return useMemo<Actions>(() => {
    // The started task always lands in the top card, whose notes field stays mounted.
    // Focusing it synchronously inside the tap is what lets iOS raise the keyboard.
    const focusNotes = (force: boolean) => {
      const el = notesRef.current;
      if (!el) return;
      if (force || !coarse()) el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    // This week's WRIT ticket and the task for it, if there is one (the newest, unarchived first).
    const findWeekly = () => {
      const w = getWeekly();
      const snap = sync.getSnapshot();
      const field = snap.config.profile.connectwise?.ticketField;
      if (!w || !field) {
        void refreshWeekly();
        showToast("This week's WRIT isn't known yet: check the connection and try again");
        return null;
      }
      const n = String(w.ticket);
      const task = Object.values(snap.view.tasks)
        .filter((t) => !t.deleted && ticketNumber(String(t.fields[field] ?? "")) === n)
        .sort((x, y) => Number(x.status === "archived") - Number(y.status === "archived") || y.updatedAt - x.updatedAt)[0];
      return { w, field, n, task };
    };
    const openSessionOf = (taskId: Id) =>
      Object.values(sync.getSnapshot().view.sessions).some((s) => !s.deleted && s.end === null && s.taskId === taskId);
    return {
      notesRef,
      startNew(title = "", alongside = false, projectId = null) {
        const taskId = newId();
        const sessionId = newId();
        activate(taskId);
        focusNotes(true);
        send({
          type: "task.start",
          taskId,
          sessionId,
          newTask: { title, projectId },
          mode: alongside ? "alongside" : "switch",
        });
        return sessionId;
      },
      startWeekly(alongside = false) {
        const weekly = findWeekly();
        if (!weekly) return;
        const { w, field, n, task } = weekly;
        const taskId = task?.id ?? newId();
        activate(taskId);
        focusNotes(true);
        send({
          type: "task.start",
          taskId,
          sessionId: newId(),
          ...(task ? {} : { newTask: { title: w.summary, fields: { [field]: n } } }),
          mode: alongside ? "alongside" : "switch",
        });
      },
      moveToWeekly(sessionId) {
        const weekly = findWeekly();
        const s = sync.getSnapshot().view.sessions[sessionId];
        if (!weekly || !s || s.deleted) return;
        const { w, field, n, task } = weekly;
        if (task?.id === s.taskId) return;
        if (task && s.end === null && openSessionOf(task.id)) {
          showToast("This week's WRIT is already running");
          return;
        }
        const taskId = task?.id ?? newId();
        undoable(
          "Move to WRIT",
          () => {
            if (!task) send({ type: "task.create", taskId, title: w.summary, projectId: null, fields: { [field]: n } });
            activate(taskId);
            send({ type: "session.move", sessionId, taskId });
          },
          { toast: `Moved to this week's WRIT (#${n})` },
        );
      },
      continueTask(taskId, alongside = false) {
        activate(taskId);
        focusNotes(false);
        send({ type: "task.start", taskId, sessionId: newId(), mode: alongside ? "alongside" : "switch" });
      },
      pause(sessionId) {
        send({ type: "timer.pause", sessionId });
      },
      newEntry(sessionId, fields) {
        const s = sync.getSnapshot().view.sessions[sessionId];
        if (!s || s.deleted || s.end !== null) return;
        const id = newId();
        send({
          type: "task.start",
          taskId: s.taskId,
          sessionId: id,
          mode: "alongside",
          fresh: true,
          ...(fields ? { sessionFields: fields } : {}),
        });
        return id;
      },
      stop(target) {
        send({ type: "timer.stop", ...target });
      },
      addInbox(title, projectId, fields = {}) {
        send({ type: "task.create", taskId: newId(), title, projectId, fields });
      },
      updateTask(taskId, patch) {
        // Typing a title or description isn't a step: the text box has its own undo.
        const label =
          patch.status === "done" ? "Mark done" : patch.status === "archived" ? "Archive" : patch.status === "open" ? "Reopen"
          : patch.projectId !== undefined ? "Project change"
          : patch.fields ? "Field change"
          : null;
        if (!label) {
          send({ type: "task.update", taskId, patch }, 600);
          return;
        }
        undoable(label, () => send({ type: "task.update", taskId, patch }, 600), { key: `t:${taskId}:${Object.keys(patch).sort().join()}` });
      },
      setTaskField(taskId, key, value) {
        undoable(`${fieldLabel(key)} change`, () => send({ type: "task.update", taskId, patch: { fields: { [key]: value } } }, 600), {
          key: `t:${taskId}:fields.${key}`,
        });
      },
      async lookupTicket(taskId, opts) {
        const snap = sync.getSnapshot();
        const cw = snap.config.profile.connectwise;
        const task = snap.view.tasks[taskId];
        const n = task && cw ? ticketNumber(String(task.fields[cw.ticketField] ?? "")) : "";
        if (!cw || !n) return null;
        try {
          const res = await api(`/api/cw/tickets/${n}`);
          const t = (await res.json()) as { summary: string; company: string; companyId?: number | null; closed: boolean };
          // The ticket says whose work it is: its CW company becomes the task's client,
          // replacing whatever was there (the client linked to it, found or added).
          const fill: Fields = {};
          const clientDef = snap.config.profile.fields.find((f) => f.key === cw.clientField);
          // As the task is now, after the request: skipped if its ticket # changed meanwhile.
          const now = sync.getSnapshot().view.tasks[taskId];
          const same = !!now && ticketNumber(String(now.fields[cw.ticketField] ?? "")) === n;
          if (clientDef?.list && t.companyId && same) {
            const id = clientFor(clientDef.list, { id: t.companyId, name: t.company });
            if (now.fields[clientDef.key] !== id) {
              send({ type: "task.update", taskId, patch: { fields: { [clientDef.key]: id } } });
            }
          } else if (clientDef?.list) {
            // An older server without the company's id: fill the client by name if unset.
            const item = Object.values(sync.getSnapshot().view.lists).find(
              (x) => x.list === clientDef.list && !x.archived && companyKey(x.name) === companyKey(t.company),
            );
            if (item) fill[clientDef.key] = item.id;
          }
          send({
            type: "task.refInfo",
            taskId,
            field: cw.ticketField,
            ref: n,
            info: {
              summary: t.summary,
              company: t.company,
              ...(t.companyId ? { companyId: t.companyId } : {}),
              closed: t.closed,
              fetchedAt: Date.now(),
            },
            fill,
            ...(opts?.keepTitle ? { keepTitle: true } : {}),
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
      async updateTicketSummary(taskId) {
        const snap = sync.getSnapshot();
        const cw = snap.config.profile.connectwise;
        const task = snap.view.tasks[taskId];
        const n = task && cw ? ticketNumber(String(task.fields[cw.ticketField] ?? "")) : "";
        if (!task || !n) return "No ticket #";
        if (!(await sync.sendNow())) return "Couldn't send your latest changes to the server first";
        try {
          await api(`/api/cw/tickets/${n}/summary`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ taskId, summary: task.title.trim() }),
          });
          return null;
        } catch (err) {
          if (err instanceof SignedOut) return "Signed out: reload to sign in";
          return (err as Error).message === "400" ? "ConnectWise allows 100 characters in a summary" : "Couldn't update the ticket in ConnectWise";
        }
      },
      async cwBoards() {
        try {
          return await (await api("/api/cw/boards")).json();
        } catch (err) {
          if (err instanceof SignedOut) return { error: "Signed out: reload to sign in." };
          return { error: "Couldn't load the boards from ConnectWise." };
        }
      },
      async createCwTicket(t) {
        // The server reads the task's client from its own state: send what's queued here first.
        if (!(await sync.sendNow())) return { error: "Couldn't send your latest changes to the server first. Check the connection and try again." };
        try {
          const res = await fetch("/api/cw/tickets", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(t),
            redirect: "manual",
          });
          if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) return { error: "Signed out: reload to sign in, then try again." };
          const body = await res.json().catch(() => ({}));
          if (res.ok && body.ticketId) return body as { ticketId: number; pushed?: PushResult[]; pushError?: string };
          return { error: (body.error as string) || "Couldn't make the ticket." };
        } catch {
          return { error: "Couldn't reach the server. No ticket was made." };
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
        // Notes are typed (their editor has its own undo); ext is what an integration records.
        const keys = Object.keys(patch).filter((k) => k !== "notes" && k !== "ext").sort();
        if (!keys.length) {
          send({ type: "session.update", sessionId, patch }, 800);
          return;
        }
        const label =
          "enteredAt" in patch ? (patch.enteredAt ? "Mark entered" : "Back to To enter")
          : keys.includes("start") || keys.includes("end") ? "Time change"
          : keys.includes("deductMin") ? "Deduct change"
          : "Entry change";
        undoable(label, () => send({ type: "session.update", sessionId, patch }, 800), { key: `s:${sessionId}:${keys.join()}` });
      },
      setSessionField(sessionId, key, value) {
        undoable(`${fieldLabel(key)} change`, () => send({ type: "session.update", sessionId, patch: { fields: { [key]: value } } }, 800), {
          key: `s:${sessionId}:fields.${key}`,
        });
      },
      mergeSessions(sessionIds) {
        undoable("Merge", () => send({ type: "session.merge", sessionIds }), { toast: `Merged ${sessionIds.length} entries` });
      },
      moveSession(sessionId, to) {
        const snap = sync.getSnapshot();
        const s = snap.view.sessions[sessionId];
        if (!s || s.deleted) return false;
        if (typeof to === "string") {
          const task = snap.view.tasks[to];
          if (!task || task.deleted || to === s.taskId) return false;
          if (s.end === null && openSessionOf(to)) {
            showToast("That task is running too: pause one of them first");
            return false;
          }
        }
        const title = typeof to === "string" ? displayTitle(snap.view.tasks[to]!, []).text : to.title.trim();
        undoable(
          "Move",
          () => {
            let taskId = to;
            if (typeof taskId !== "string") {
              taskId = newId();
              send({ type: "task.create", taskId, title: title, projectId: null });
            }
            if (s.end === null) activate(taskId);
            send({ type: "session.move", sessionId, taskId });
          },
          { toast: `Moved to ${title ? `“${title}”` : "a new task"}` },
        );
        return true;
      },
      createSession(taskId, start, end) {
        const sessionId = newId();
        undoable("Add time", () => send({ type: "session.create", sessionId, taskId, start, end }));
        return sessionId;
      },
      createTaskWithSession(title, start, end) {
        const taskId = newId();
        const sessionId = newId();
        undoable("Add time", () => {
          send({ type: "task.create", taskId, title: title.trim(), projectId: null });
          send({ type: "session.create", sessionId, taskId, start, end });
        });
        return sessionId;
      },
      deleteSession(sessionId) {
        undoable("Delete", () => send({ type: "session.delete", sessionId }), { toast: "Session deleted" });
      },
      deleteTask(taskId) {
        const info = sync.getSnapshot().view.tasks[taskId];
        undoable("Delete", () => send({ type: "task.delete", taskId }), {
          toast: `Deleted ${info?.title.trim() ? `“${info.title.trim()}”` : "the task"}`,
        });
      },
      createListItem(list, name) {
        const itemId = newId();
        send({ type: "list.create", itemId, list, name: name.trim() });
        return itemId;
      },
      clientForCompany: clientFor,
      removeListItem(itemId) {
        const name = sync.getSnapshot().view.lists[itemId]?.name ?? "";
        send({ type: "list.update", itemId, patch: { archived: true } });
        showToast(`Removed ${name}`, {
          label: "Undo",
          run: () => send({ type: "list.update", itemId, patch: { archived: false } }),
        });
      },
      restoreListItem(itemId) {
        send({ type: "list.update", itemId, patch: { archived: false } });
      },
      createProject(title, parentId) {
        const projectId = newId();
        send({ type: "project.create", projectId, title: title.trim(), parentId });
        return projectId;
      },
      updateProject(projectId, patch) {
        if (patch.status === undefined && patch.parentId === undefined) {
          send({ type: "project.update", projectId, patch }, 600);
          return;
        }
        undoable("Project change", () => send({ type: "project.update", projectId, patch }, 600));
      },
      updateSettings(patch) {
        send({ type: "settings.update", patch });
      },
    };
  }, []);
}

export const ModelContext = createContext<Model | null>(null);
export const ActionsContext = createContext<Actions | null>(null);

export const useM = () => useContext(ModelContext)!;
export const useA = () => useContext(ActionsContext)!;
