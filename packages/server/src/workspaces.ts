import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Profile } from "@sideshow/shared";
import { snapshot, startBackups } from "./backup";
import { openDb, type DB } from "./db";
import { FileStore } from "./files";
import type { ConnectWiseClient } from "./integrations/connectwise/client";
import { CompanyCache } from "./integrations/connectwise/companies";
import { CwDocuments } from "./integrations/connectwise/documents";
import { ScheduleHolds } from "./integrations/connectwise/holds";
import { TicketMaker } from "./integrations/connectwise/tickets";
import { WeeklyTickets } from "./integrations/connectwise/weekly";
import { defaultsBackfill, loadProfile, profileListChanges } from "./profile";
import { Store } from "./store";

// Workspaces (DESIGN.md §4): separate sets of data, each with its own database and profile.
// The data in one never appears in another. The main workspace is the database there always was
// (data/sideshow.db); others are data/workspaces/<id>.db. The list is data/workspaces.json; with
// no such file there's just the main workspace, its profile from PROFILE in .env.
//
// A workspace's profile can change (Settings): that's a lens, not a conversion (§4, "Switching
// profiles keeps data"). Values the new profile doesn't have stay in the records, hidden.

export const MAIN = "main";

export interface WorkspaceEntry {
  id: string;
  name: string;
  /**
   * The profile's file name, "" for none. Absent: PROFILE in .env (only the main workspace,
   * until its profile is changed in the app).
   */
  profile?: string;
}

/** What a workspace needs from the server around it. */
export interface WorkspaceContext {
  /** Folder with data/sideshow.db and workspaces.json. */
  dataDir: string;
  mainDbFile: string;
  backupDir: string;
  filesDir: string;
  envProfile: string | undefined;
  cw: ConnectWiseClient | null;
  /** CW_MEMBER: whose time a push enters. */
  cwMember: string | null;
  cwWeeklySummary?: string;
}

/** The list of workspaces, kept in <dataDir>/workspaces.json. */
export class Registry {
  private file: string;
  entries: WorkspaceEntry[];

  constructor(private dataDir: string) {
    this.file = join(dataDir, "workspaces.json");
    const saved = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as { workspaces: WorkspaceEntry[] }).workspaces : [];
    this.entries = saved.some((w) => w.id === MAIN) ? saved : [{ id: MAIN, name: "Main" }, ...saved];
  }

  get(id: string) {
    return this.entries.find((w) => w.id === id);
  }

  /** A new workspace's id: its name as a slug, starting with a letter, not taken. */
  newId(name: string): string {
    let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "workspace";
    if (!/^[a-z]/.test(base)) base = `w-${base}`;
    let id = base;
    for (let n = 2; id === MAIN || this.get(id); n++) id = `${base}-${n}`;
    return id;
  }

  dbFile(id: string, mainDbFile: string) {
    return id === MAIN ? mainDbFile : join(this.dataDir, "workspaces", `${id}.db`);
  }

  save() {
    mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ workspaces: this.entries }, null, 2));
    renameSync(tmp, this.file);
  }
}

/** One workspace, open: its database, state, files and (with a CW profile) the CW parts. */
export class Workspace {
  readonly db: DB;
  readonly store: Store;
  readonly files: FileStore;
  readonly backups: { latest: () => string | null; stop: () => void };
  profile!: Profile;
  cwParts: { companies: CompanyCache; documents: CwDocuments; tickets: TicketMaker; weekly: WeeklyTickets | null; holds: ScheduleHolds | null } | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private configListeners = new Set<() => void>();

  constructor(
    readonly entry: WorkspaceEntry,
    dbFile: string,
    private ctx: WorkspaceContext,
  ) {
    // A broken profile should stop the server (or the change) before anything is touched.
    const profile = loadProfile(this.profileFile());
    this.db = openDb(dbFile);
    this.store = new Store(this.db);
    this.files = new FileStore(this.db, ctx.filesDir);
    const main = entry.id === MAIN;
    // Attachments are one folder for every workspace; the main workspace backs it up.
    this.backups = startBackups(this.db, ctx.backupDir, main ? ctx.filesDir : undefined, main ? "sideshow" : `sideshow-${entry.id}`);
    this.useProfile(profile);
  }

  get id() {
    return this.entry.id;
  }

  /** Stop its timers and close its database (tests; the server keeps them open). */
  close() {
    for (const t of this.timers) clearInterval(t);
    this.backups.stop();
    this.db.close();
  }

  /** The profile's file name ("" for none), or PROFILE from .env. */
  profileFile(): string {
    return this.entry.profile ?? this.ctx.envProfile ?? "";
  }

  /** Its name or profile changed: connected devices fetch the state (and config) again. */
  onConfig(fn: () => void) {
    this.configListeners.add(fn);
    return () => this.configListeners.delete(fn);
  }

  notifyConfig() {
    for (const fn of this.configListeners) fn();
  }

  /**
   * Switch to another profile (a file name, "" for none). The database is copied first. Returns
   * the copy's path. Throws, changing nothing, if the profile can't be loaded.
   */
  setProfile(file: string): string {
    const profile = loadProfile(file);
    const at = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const copy = snapshot(this.db, this.ctx.backupDir, `sideshow-${this.id}-before-profile-${at}`);
    this.entry.profile = file;
    this.useProfile(profile);
    this.notifyConfig();
    return copy;
  }

  private useProfile(profile: Profile) {
    this.profile = profile;
    const now = Date.now();
    // A list the profile brings and the workspace doesn't have yet is filled; new or changed
    // defaults (a work type's billing) fill records that have none yet. Values are never removed.
    const listChanges = profileListChanges(profile, this.store.state, now);
    if (listChanges.length) {
      const { tasks, sessions } = defaultsBackfill(this.store.state, listChanges, now);
      this.store.seed({ lists: listChanges, projects: [], tasks, sessions });
      console.log(`[${this.id}] profile lists: ${listChanges.length} items updated, defaults filled on ${tasks.length + sessions.length} records`);
    }
    this.restartCw();
  }

  /** (Re)start the CW parts with the server's current connection (Settings › Connections changes it). */
  restartCw() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.cwParts = null;
    const { cw, cwMember } = this.ctx;
    if (!cw || !this.profile.connectwise) return;
    const log = (msg: string) => console.log(`[${this.id}] ${msg}`);
    // The company picker's copy of CW's companies: brought up to date now and every few hours.
    const companies = new CompanyCache(this.db, cw, log);
    void companies.sync();
    this.timers.push(setInterval(() => void companies.sync(), 4 * 3_600_000).unref());
    // A note's attachments go to the ticket its time is pushed to (once per ticket).
    const documents = new CwDocuments(this.db, this.files, cw);
    const tickets = new TicketMaker(cw, this.store, this.profile, cwMember, documents);
    // The weekly recurring internal ticket (WRIT): found by its summary and owner (DESIGN.md §10).
    const weekly = cwMember
      ? new WeeklyTickets(
          this.db,
          cw,
          cwMember,
          async () => {
            if (this.ctx.cwWeeklySummary) return this.ctx.cwWeeklySummary;
            const owner = await tickets.getOwner().catch(() => null);
            return owner ? `Weekly Recurring Internal Ticket - ${owner.name}` : null;
          },
          log,
        )
      : null;
    if (weekly) {
      weekly.checkIfDue();
      this.timers.push(setInterval(() => weekly.checkIfDue(), 15 * 60_000).unref());
    }
    // Schedule holds: the next few weeks of each kept on the member's CW calendar (DESIGN.md §10).
    const holds = cwMember ? new ScheduleHolds(this.db, cw, cwMember, log) : null;
    if (holds) {
      void holds.sync();
      this.timers.push(setInterval(() => void holds.sync(), 3_600_000).unref());
    }
    this.cwParts = { companies, documents, tickets, weekly, holds };
  }
}

/** Every workspace, opened at startup; new ones are made here. */
export class Workspaces {
  readonly registry: Registry;
  private open = new Map<string, Workspace>();

  constructor(private ctx: WorkspaceContext) {
    this.registry = new Registry(ctx.dataDir);
    for (const entry of this.registry.entries) this.openEntry(entry);
  }

  private openEntry(entry: WorkspaceEntry) {
    const ws = new Workspace(entry, this.registry.dbFile(entry.id, this.ctx.mainDbFile), this.ctx);
    this.open.set(entry.id, ws);
    return ws;
  }

  get(id: string) {
    return this.open.get(id);
  }

  get main() {
    return this.open.get(MAIN)!;
  }

  all() {
    return [...this.open.values()];
  }

  close() {
    for (const w of this.all()) w.close();
  }

  /** A new, empty workspace. Throws if the profile can't be loaded. */
  create(name: string, profile: string): Workspace {
    loadProfile(profile);
    const entry: WorkspaceEntry = { id: this.registry.newId(name), name, profile };
    mkdirSync(dirname(this.registry.dbFile(entry.id, this.ctx.mainDbFile)), { recursive: true });
    const ws = this.openEntry(entry);
    this.registry.entries.push(entry);
    this.registry.save();
    for (const w of this.all()) w.notifyConfig();
    return ws;
  }

  rename(id: string, name: string) {
    const ws = this.get(id);
    if (!ws) return;
    ws.entry.name = name;
    this.registry.save();
    // Every workspace's devices show the list of names.
    for (const w of this.all()) w.notifyConfig();
  }

  setProfile(id: string, profile: string): string | null {
    const ws = this.get(id);
    if (!ws) return null;
    const copy = ws.setProfile(profile);
    this.registry.save();
    return copy;
  }
}
