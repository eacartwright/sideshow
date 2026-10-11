import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_SETTINGS, type Changes, type ListItem, type Project, type Session, type Settings, type State, type Task } from "@sideshow/shared";

// SQLite persistence. Plain tables with one row per entity, so the file stays
// readable in any SQLite browser. Schema changes go in MIGRATIONS, in order.

const MIGRATIONS: string[] = [
  `
  CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rev INTEGER NOT NULL
  );
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    rev INTEGER NOT NULL
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    group_id TEXT,
    ref TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rev INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    start INTEGER NOT NULL,
    "end" INTEGER,
    deduct_min INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    category_id TEXT,
    updated_at INTEGER NOT NULL,
    rev INTEGER NOT NULL
  );
  CREATE INDEX sessions_task ON sessions(task_id);
  CREATE INDEX sessions_start ON sessions(start);
  -- Every op the server has applied, for idempotency and as an audit trail.
  CREATE TABLE ops (
    id TEXT PRIMARY KEY,
    at INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    body TEXT NOT NULL
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // Sessions merged away or discarded as blips are flagged rather than removed, so the change syncs.
  `ALTER TABLE sessions ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;`,
  // When a session was marked as entered into the external system (CW).
  `ALTER TABLE sessions ADD COLUMN entered_at INTEGER;`,
  // Paused tasks stay on the Now stack until stopped.
  `ALTER TABLE tasks ADD COLUMN paused_at INTEGER;`,
  // Edited after being marked entered: the external entry needs fixing too.
  `ALTER TABLE sessions ADD COLUMN changed_since_entered INTEGER NOT NULL DEFAULT 0;`,
  // What the task's ref points to (a CW ticket), as JSON: RefInfo.
  `ALTER TABLE tasks ADD COLUMN ref_info TEXT;`,
  // Projects (any depth) and the project each task belongs to.
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    parent_id TEXT,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rev INTEGER NOT NULL
  );
  ALTER TABLE tasks ADD COLUMN project_id TEXT;
  `,
  // Profiles (DESIGN.md §4): client, ticket # and work type become profile fields in a JSON
  // `fields` column, keyed as in profiles/veritaz-cw.json, and clients and work types become
  // items of one `list_items` table, keeping their ids. Ticket info records which field and
  // number it describes. The old columns and tables (group_id, ref, category_id, groups,
  // categories) are left in place but unused from here on; rows saved later leave them blank.
  `
  CREATE TABLE list_items (
    id TEXT PRIMARY KEY,
    list TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    defaults TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rev INTEGER NOT NULL
  );
  INSERT INTO list_items (id, list, name, position, archived, created_at, updated_at, rev)
    SELECT id, 'clients', name, 0, archived, created_at, updated_at, rev FROM groups;
  INSERT INTO list_items (id, list, name, position, archived, created_at, updated_at, rev)
    SELECT id, 'workTypes', name, position, archived, 0, 0, rev FROM categories;
  ALTER TABLE tasks ADD COLUMN fields TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE sessions ADD COLUMN fields TEXT NOT NULL DEFAULT '{}';
  UPDATE tasks SET fields = json_set(fields, '$.client', group_id) WHERE group_id IS NOT NULL AND group_id <> '';
  UPDATE tasks SET fields = json_set(fields, '$.ticket', ref) WHERE trim(ref) <> '';
  UPDATE tasks SET ref_info = json_set(ref_info, '$.field', 'ticket', '$.ref', trim(ltrim(trim(ref), '#')))
    WHERE ref_info IS NOT NULL;
  UPDATE sessions SET fields = json_set(fields, '$.workType', category_id) WHERE category_id IS NOT NULL AND category_id <> '';
  `,
  // Integration data per session (JSON: Ext), e.g. the CW time entry it was pushed as.
  `ALTER TABLE sessions ADD COLUMN ext TEXT NOT NULL DEFAULT '{}';`,
];

export type DB = DatabaseSync;

/** Open (creating if needed) and bring the schema up to date. `upTo` stops early, for tests. */
export function openDb(file: string, upTo = MIGRATIONS.length): DB {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (version > 0 && version < upTo) {
    // Keep a copy from before the schema changes, so a bad migration can be undone.
    const copy = `${file}.before-v${version + 1}.db`;
    if (!existsSync(copy)) db.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
  }
  for (let v = version; v < upTo; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

/** Run `fn` in a write transaction; rolls back if it throws. */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getRev(db: DB): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'rev'").get() as { value: string } | undefined;
  return row ? Number(row.value) : 0;
}

export function setRev(db: DB, rev: number) {
  db.prepare("INSERT INTO meta (key, value) VALUES ('rev', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    String(rev),
  );
}

const json = <T>(text: string | null, fallback: T): T => (text ? (JSON.parse(text) as T) : fallback);

export function loadState(db: DB): State {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'settings'").get() as { value: string } | undefined;
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(row ? (JSON.parse(row.value) as Partial<Settings>) : {}) };
  const state: State = { lists: {}, projects: {}, tasks: {}, sessions: {}, settings };
  for (const r of db.prepare("SELECT * FROM list_items").all() as any[]) {
    state.lists[r.id] = {
      id: r.id,
      list: r.list,
      name: r.name,
      position: r.position,
      archived: !!r.archived,
      defaults: json(r.defaults, null),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      rev: r.rev,
    };
  }
  for (const r of db.prepare("SELECT * FROM projects").all() as any[]) {
    state.projects[r.id] = {
      id: r.id,
      title: r.title,
      parentId: r.parent_id,
      description: r.description,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      rev: r.rev,
    };
  }
  for (const r of db.prepare("SELECT * FROM tasks").all() as any[]) {
    state.tasks[r.id] = {
      id: r.id,
      title: r.title,
      projectId: r.project_id,
      fields: json(r.fields, {}),
      description: r.description,
      status: r.status,
      pausedAt: r.paused_at,
      refInfo: json(r.ref_info, null),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      rev: r.rev,
    };
  }
  for (const r of db.prepare("SELECT * FROM sessions").all() as any[]) {
    state.sessions[r.id] = {
      id: r.id,
      taskId: r.task_id,
      start: r.start,
      end: r.end,
      deductMin: r.deduct_min,
      notes: r.notes,
      fields: json(r.fields, {}),
      ext: json(r.ext, {}),
      enteredAt: r.entered_at,
      changedSinceEntered: !!r.changed_since_entered,
      deleted: !!r.deleted,
      updatedAt: r.updated_at,
      rev: r.rev,
    };
  }
  return state;
}

export function saveChanges(db: DB, c: Changes) {
  const l = db.prepare(`INSERT OR REPLACE INTO list_items (id, list, name, position, archived, defaults, created_at, updated_at, rev)
    VALUES (@id, @list, @name, @position, @archived, @defaults, @createdAt, @updatedAt, @rev)`);
  const t = db.prepare(`INSERT OR REPLACE INTO tasks (id, title, project_id, fields, ref_info, description, status, paused_at, created_at, updated_at, rev)
    VALUES (@id, @title, @projectId, @fields, @refInfo, @description, @status, @pausedAt, @createdAt, @updatedAt, @rev)`);
  const p = db.prepare(`INSERT OR REPLACE INTO projects (id, title, parent_id, description, status, created_at, updated_at, rev)
    VALUES (@id, @title, @parentId, @description, @status, @createdAt, @updatedAt, @rev)`);
  const s = db.prepare(`INSERT OR REPLACE INTO sessions (id, task_id, start, "end", deduct_min, notes, fields, ext, entered_at, changed_since_entered, deleted, updated_at, rev)
    VALUES (@id, @taskId, @start, @end, @deductMin, @notes, @fields, @ext, @enteredAt, @changedSinceEntered, @deleted, @updatedAt, @rev)`);
  for (const x of c.lists) {
    l.run({
      ...x,
      archived: x.archived ? 1 : 0,
      defaults: x.defaults ? JSON.stringify(x.defaults) : null,
    } satisfies Record<keyof ListItem, unknown>);
  }
  for (const x of c.projects) p.run({ ...x } satisfies Record<keyof Project, unknown>);
  for (const x of c.tasks) {
    t.run({
      ...x,
      projectId: x.projectId ?? null,
      fields: JSON.stringify(x.fields ?? {}),
      pausedAt: x.pausedAt ?? null,
      refInfo: x.refInfo ? JSON.stringify(x.refInfo) : null,
    } satisfies Record<keyof Task, unknown>);
  }
  if (c.settings) {
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(JSON.stringify(c.settings));
  }
  for (const x of c.sessions) {
    s.run({
      ...x,
      fields: JSON.stringify(x.fields ?? {}),
      ext: JSON.stringify(x.ext ?? {}),
      enteredAt: x.enteredAt ?? null,
      changedSinceEntered: x.changedSinceEntered ? 1 : 0,
      deleted: x.deleted ? 1 : 0,
    } satisfies Record<keyof Session, unknown>);
  }
}
