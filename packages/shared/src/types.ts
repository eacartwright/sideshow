// Core data model. Job-agnostic: everything job-specific (client, ticket #, work type…) is a
// profile field stored in a record's `fields`, and the lists those fields pick from are
// ListItems. See DESIGN.md §4–5 and profile.ts.

export type Id = string;
/** Milliseconds since epoch. */
export type Ms = number;

export type TaskStatus = "open" | "done" | "archived";

/**
 * Profile field values, keyed by field key (FieldDef.key). A list field holds a ListItem id.
 * An unset field is absent, never "" or null.
 */
export type FieldValue = string | boolean;
export type Fields = Record<string, FieldValue>;
/** A change to some fields: null (or "") clears one. */
export type FieldsPatch = Record<string, FieldValue | null>;

/**
 * What an integration keeps on a session, under its own key ("cw"): the id of the entry it
 * made in the other system, and per-entry push options (CW: email on/off). Unlike fields, it's
 * never copied to a task's next session, so an option like "email the client" can't carry over.
 */
export type ExtValue = string | number | boolean;
export type Ext = Record<string, Record<string, ExtValue>>;
/** Merged key by key, per integration; null removes a key. */
export type ExtPatch = Record<string, Record<string, ExtValue | null>>;

/** An item in one of the profile's lists: a client, a work type… */
export interface ListItem {
  id: Id;
  /** Which list ("clients", "workTypes"). */
  list: string;
  name: string;
  position: number;
  archived: boolean;
  /** Values a session takes when this item is chosen (a work type's billing). */
  defaults?: Fields | null;
  createdAt: Ms;
  updatedAt: Ms;
  /** Server revision of the last change. 0 until the server has seen it. */
  rev: number;
}

/** A group of tasks and other projects (DESIGN.md §5). Nests to any depth. */
export interface Project {
  id: Id;
  title: string;
  /** The project it sits in. Never itself or one of its own descendants. */
  parentId: Id | null;
  description: string;
  status: TaskStatus;
  createdAt: Ms;
  updatedAt: Ms;
  rev: number;
}

export interface Task {
  id: Id;
  /** May be empty: the first line of the notes stands in until it's named. */
  title: string;
  /** Missing on tasks saved before projects existed. */
  projectId?: Id | null;
  fields: Fields;
  /**
   * What a reference field points to, looked up in the integration (a CW ticket). Cleared
   * when that field changes to a different number.
   */
  refInfo?: RefInfo | null;
  description: string;
  status: TaskStatus;
  /**
   * Set while the task is paused: its clock is stopped but it stays on the Now stack.
   * Cleared when it starts again or is stopped.
   */
  pausedAt?: Ms | null;
  createdAt: Ms;
  updatedAt: Ms;
  rev: number;
}

export interface RefInfo {
  /** The field it was looked up from, and the number it describes. */
  field: string;
  ref: string;
  summary: string;
  /** The external system's name for the client (CW company). */
  company: string;
  closed: boolean;
  fetchedAt: Ms;
}

export interface Session {
  id: Id;
  taskId: Id;
  start: Ms;
  /** null while running. Several tasks can run at once, but each task has at most one open session. */
  end: Ms | null;
  deductMin: number;
  notes: string;
  fields: Fields;
  /** Integration data (see Ext). Absent on sessions from before it existed. */
  ext?: Ext;
  /** When it was marked as entered into the external system (e.g. a CW time entry). */
  enteredAt?: Ms | null;
  /** Edited after it was marked entered, so the external entry needs fixing too. Cleared when re-marked. */
  changedSinceEntered?: boolean;
  /** Merged into another session or discarded as a blip. Kept (not removed) so the change syncs. */
  deleted?: boolean;
  updatedAt: Ms;
  rev: number;
}

/** Rules the reducer applies. Synced, so every device and the server agree. 0 turns a rule off. */
export interface Settings {
  /** A session shorter than this with no notes is discarded when it ends (unless it's the task's only one). */
  blipSec: number;
  /** Starting a task within this long of its last session reopens that session. */
  resumeGapMin: number;
  rev: number;
}

export const DEFAULT_SETTINGS: Settings = { blipSec: 30, resumeGapMin: 10, rev: 0 };

export interface State {
  lists: Record<Id, ListItem>;
  projects: Record<Id, Project>;
  tasks: Record<Id, Task>;
  sessions: Record<Id, Session>;
  /** Missing in states cached before settings existed; read it with settingsOf(). */
  settings?: Settings;
}

export function emptyState(): State {
  return { lists: {}, projects: {}, tasks: {}, sessions: {}, settings: { ...DEFAULT_SETTINGS } };
}

export function settingsOf(state: State): Settings {
  return state.settings ?? DEFAULT_SETTINGS;
}

/** Entities changed by applying ops; what the server persists and broadcasts. */
export interface Changes {
  lists: ListItem[];
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
  /** Present only when the settings changed. */
  settings?: Settings | null;
}
