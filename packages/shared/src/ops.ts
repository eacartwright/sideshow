import type { Ext, ExtPatch, Fields, FieldsPatch, Id, ListItem, Ms, Project, RefInfo, Session, Settings, Task } from "./types";

// Every change to the data is an op. Clients apply ops locally right away and
// queue them for the server, which applies the same ops with the same reducer.

/**
 * How starting a task treats whatever else is running:
 * "switch" stops it (the default), "alongside" leaves it running.
 */
export type StartMode = "switch" | "alongside";

export type Op =
  /** Start working on a task, creating it first if `newTask` is given. Covers ▶ New and ▶ Continue. */
  | {
      type: "task.start";
      taskId: Id;
      sessionId: Id;
      newTask?: { title: string; projectId?: Id | null; fields?: Fields };
      mode?: StartMode;
      /**
       * A new entry: always a new session, never reopening one within the resume gap. If the
       * task is running then, its session ends at that moment (travel ends, onsite begins).
       */
      fresh?: boolean;
      /** Patched onto the new session's carried-over fields (the next entry's work type). */
      sessionFields?: FieldsPatch;
    }
  /**
   * Stop a session and/or a task, taking it off the Now stack (running or paused).
   * With neither, stops everything and clears every paused task.
   */
  | { type: "timer.stop"; sessionId?: Id; taskId?: Id }
  /** Stop the clock on a session but keep its task on the Now stack; everything running if no sessionId. */
  | { type: "timer.pause"; sessionId?: Id }
  /** Create a task without starting it (Inbox). */
  | { type: "task.create"; taskId: Id; title: string; projectId?: Id | null; fields?: Fields }
  | { type: "task.update"; taskId: Id; patch: TaskPatch }
  /**
   * The result of looking up a reference field (a CW ticket #). Ignored if the field has
   * changed since. Fills the title if the task is still untitled, and each of `fill` that's
   * still unset (the client, from the ticket's company).
   */
  | { type: "task.refInfo"; taskId: Id; field: string; ref: string; info: RefLookup; fill?: Fields }
  | { type: "session.update"; sessionId: Id; patch: SessionPatch }
  /** Add time after the fact (no timer was running). Fields default to the task's previous session's. */
  | {
      type: "session.create";
      sessionId: Id;
      taskId: Id;
      start: Ms;
      end: Ms;
      fields?: Fields;
      notes?: string;
    }
  /** Delete a session (a tombstone), or bring it back with `undo`. */
  | { type: "session.delete"; sessionId: Id; undo?: boolean }
  /** Delete a task and its sessions (stopping it if running); `undo` brings them back. */
  | { type: "task.delete"; taskId: Id; undo?: boolean }
  /** Combine sessions of one task into the earliest of them. */
  | { type: "session.merge"; sessionIds: Id[] }
  | { type: "list.create"; itemId: Id; list: string; name: string; ext?: Ext }
  /** `ext` merges like a session's: per integration, key by key, null removes. */
  | { type: "list.update"; itemId: Id; patch: Partial<Pick<ListItem, "name" | "archived" | "position" | "defaults">> & { ext?: ExtPatch } }
  | { type: "project.create"; projectId: Id; title: string; parentId: Id | null }
  /** A parent that would put the project inside itself (or doesn't exist) is ignored. */
  | { type: "project.update"; projectId: Id; patch: ProjectPatch }
  | { type: "settings.update"; patch: Partial<Pick<Settings, "blipSec" | "resumeGapMin">> };

export type RefLookup = Omit<RefInfo, "field" | "ref">;
/** `fields` is merged into the task's fields, key by key. */
export type TaskPatch = Partial<Pick<Task, "title" | "projectId" | "description" | "status">> & { fields?: FieldsPatch };
export type ProjectPatch = Partial<Pick<Project, "title" | "parentId" | "description" | "status">>;
export type SessionPatch = Partial<Pick<Session, "notes" | "start" | "end" | "deductMin" | "enteredAt">> & {
  fields?: FieldsPatch;
  /** Integration data; changing it doesn't count as editing the entry. */
  ext?: ExtPatch;
};

/**
 * Op types the server accepts. "group.*" and the older shapes of some ops (groupId, ref,
 * categoryId) are from before profiles (migration 8): a device may still have them queued, so
 * the reducer upgrades them (upgradeOp in reducer.ts).
 */
export const OP_TYPES: ReadonlySet<string> = new Set([
  "task.start",
  "timer.stop",
  "timer.pause",
  "task.create",
  "task.update",
  "task.refInfo",
  "session.update",
  "session.create",
  "session.delete",
  "session.merge",
  "list.create",
  "list.update",
  "project.create",
  "project.update",
  "settings.update",
  "task.delete",
  "group.create",
  "group.update",
]);

export interface OpEnvelope {
  /** Unique per op; the server ignores ids it has already applied. */
  id: Id;
  /** When the user did it (client clock). Start/stop use this as the session time. */
  at: Ms;
  op: Op;
}
