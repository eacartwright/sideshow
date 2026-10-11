import {
  applyOp,
  emptyState,
  newId,
  NO_PROFILE,
  type Changes,
  type Id,
  type Op,
  type OpEnvelope,
  type Profile,
  type State,
} from "@sideshow/shared";

// Client side of sync. What the UI shows is always:
//   the last state confirmed by the server + ops not yet confirmed, replayed on top.
// Ops are written to localStorage before anything is sent, so a dropped
// connection or closed tab never loses them. Everything is instant locally.

export interface Config {
  /** The job's fields (DESIGN.md §4). */
  profile: Profile;
  /** The server has ConnectWise set up (ticket lookup). Missing in configs cached before it existed. */
  cw?: boolean;
  /** Time entries can be pushed to CW (CW_MEMBER is set). */
  cwPush?: boolean;
  /** A ticket's page in CW, with {id} for the number. */
  cwTicketUrl?: string | null;
}

/** "signedout": the login in front of the server (Cloudflare Access) has expired. */
export type Connection = "connecting" | "online" | "offline" | "signedout";

export interface Snapshot {
  view: State;
  config: Config;
  loaded: boolean;
  connection: Connection;
  pending: number;
}

// The cache is only a head start until the server answers, so a new shape just gets a new key.
const CACHE_KEY = "sideshow:cache:2";
const PENDING_KEY = "sideshow:pending";
/** From before the rename (2026-10). Unsent ops there are carried over, on the same address. */
const OLD_PENDING_KEY = "fieldtime:pending";
const KINDS = ["lists", "projects", "tasks", "sessions"] as const;

export class SignedOut extends Error {}

/** fetch, but a redirect (to the Access login page) is reported as SignedOut instead of a CORS failure. */
export async function api(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { ...init, redirect: "manual" });
  if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) throw new SignedOut();
  if (!res.ok) throw new Error(String(res.status));
  return res;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the server still has everything confirmed */
  }
}

class Sync {
  private server: State = emptyState();
  private rev = 0;
  private config: Config = { profile: NO_PROFILE };
  private loaded = false;
  private pending: OpEnvelope[] = [];
  private inflight = new Set<Id>();
  private connection: Connection = "connecting";
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = 1000;
  private cacheTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot;

  constructor() {
    const cache = read<{ server: State; rev: number; config: Config }>(CACHE_KEY);
    if (cache) {
      // A cache from an older version may lack newer kinds (projects): start those empty.
      this.server = { ...emptyState(), ...cache.server };
      this.rev = cache.rev;
      this.config = cache.config;
      this.loaded = true;
    }
    this.pending = read<OpEnvelope[]>(PENDING_KEY) ?? [];
    const old = read<OpEnvelope[]>(OLD_PENDING_KEY);
    if (old) {
      // Ops already sent are skipped by the server (by id), so a repeat is harmless.
      this.pending = [...old, ...this.pending.filter((p) => !old.some((o) => o.id === p.id))];
      write(PENDING_KEY, this.pending);
      try {
        localStorage.removeItem(OLD_PENDING_KEY);
        localStorage.removeItem("fieldtime:cache");
      } catch {
        /* storage unavailable */
      }
    }
    this.snapshot = this.build();
  }

  start() {
    void this.fetchState();
    this.listen();
    window.addEventListener("online", () => this.flush());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void this.fetchState();
        this.flush();
      }
    });
    this.flush();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  dispatch(op: Op, flushDelay = 0): OpEnvelope {
    const env: OpEnvelope = { id: newId(), at: Date.now(), op };
    const last = this.pending[this.pending.length - 1];
    // Typing produces a stream of updates to the same field; keep only the latest unsent one.
    if (last && !this.inflight.has(last.id) && sameTarget(last.op, op)) {
      this.pending[this.pending.length - 1] = env;
    } else {
      this.pending.push(env);
    }
    write(PENDING_KEY, this.pending);
    this.recompute();
    this.scheduleFlush(flushDelay);
    return env;
  }

  private build(): Snapshot {
    const view = structuredClone(this.server);
    for (const env of this.pending) applyOp(view, env);
    return {
      view,
      config: this.config,
      loaded: this.loaded,
      connection: this.connection,
      pending: this.pending.length,
    };
  }

  private recompute() {
    this.snapshot = this.build();
    for (const fn of this.listeners) fn();
  }

  private setConnection(c: Connection) {
    if (this.connection === c) return;
    this.connection = c;
    this.recompute();
  }

  private merge(changes: Changes) {
    for (const kind of KINDS) {
      const rec = this.server[kind] as Record<Id, { rev: number }>;
      for (const e of changes[kind]) {
        const existing = rec[e.id];
        if (!existing || e.rev >= existing.rev) rec[e.id] = e;
      }
    }
    const st = changes.settings;
    if (st && (!this.server.settings || st.rev >= this.server.settings.rev)) this.server.settings = st;
  }

  private saveCache() {
    clearTimeout(this.cacheTimer);
    this.cacheTimer = setTimeout(
      () => write(CACHE_KEY, { server: this.server, rev: this.rev, config: this.config }),
      500,
    );
  }

  private async fetchState() {
    try {
      const res = await api("/api/state");
      const body = (await res.json()) as { state: State; rev: number; config: Config };
      this.server = body.state;
      this.rev = body.rev;
      this.config = body.config;
      this.loaded = true;
      this.saveCache();
      this.recompute();
    } catch (err) {
      this.setConnection(err instanceof SignedOut ? "signedout" : "offline");
    }
  }

  private listen() {
    const es = new EventSource("/api/events");
    es.addEventListener("hello", (e) => {
      this.setConnection("online");
      const { rev } = JSON.parse((e as MessageEvent).data) as { rev: number };
      if (rev !== this.rev) void this.fetchState();
      this.flush();
    });
    es.addEventListener("changes", (e) => {
      const { rev, changes } = JSON.parse((e as MessageEvent).data) as { rev: number; changes: Changes };
      this.merge(changes);
      this.rev = Math.max(this.rev, rev);
      this.saveCache();
      this.recompute();
    });
    // EventSource reconnects on its own; "hello" on reconnect catches us up.
    // A failed EventSource can't say why, so ask the state endpoint, which can tell
    // "offline" from "signed out".
    es.onerror = () => {
      if (this.connection !== "signedout") this.setConnection("offline");
      void this.fetchState();
    };
  }

  /**
   * Send everything queued now, debounced edits included, and resolve true once the server has
   * it all (false if offline or it takes too long). Used before asking the server to act on the
   * state, e.g. pushing time entries, so it acts on what the user sees.
   */
  async sendNow(timeoutMs = 10_000): Promise<boolean> {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const until = Date.now() + timeoutMs;
    while (this.pending.length) {
      if (Date.now() > until || this.connection === "offline" || this.connection === "signedout") return false;
      void this.flush();
      await new Promise((r) => setTimeout(r, 100));
    }
    return true;
  }

  private scheduleFlush(delay: number) {
    if (delay === 0) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        this.flush();
      }, delay);
    }
  }

  private async flush() {
    if (this.inflight.size || !this.pending.length) return;
    const batch = this.pending.slice();
    for (const env of batch) this.inflight.add(env.id);
    try {
      const res = await api("/api/ops", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ops: batch }),
      });
      const body = (await res.json()) as { rev: number; changes: Changes };
      this.merge(body.changes);
      this.rev = Math.max(this.rev, body.rev);
      const sent = new Set(batch.map((b) => b.id));
      this.pending = this.pending.filter((p) => !sent.has(p.id));
      write(PENDING_KEY, this.pending);
      this.saveCache();
      this.retryDelay = 1000;
      this.inflight.clear();
      this.setConnection("online");
      this.recompute();
      if (this.pending.length) this.flush();
    } catch (err) {
      this.inflight.clear();
      this.setConnection(err instanceof SignedOut ? "signedout" : "offline");
      const delay = this.retryDelay;
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
      setTimeout(() => this.flush(), delay);
    }
  }
}

/** A patch's keys, counting each changed field separately ("fields.ticket"). */
function patchKeys(p: object): string {
  return Object.entries(p)
    .flatMap(([k, v]) => (k === "fields" && v ? Object.keys(v).map((f) => `fields.${f}`) : [k]))
    .sort()
    .join();
}

function sameKeys(a: object, b: object) {
  return patchKeys(a) === patchKeys(b);
}

function sameTarget(a: Op, b: Op): boolean {
  if (a.type === "session.update" && b.type === "session.update")
    return a.sessionId === b.sessionId && sameKeys(a.patch, b.patch);
  if (a.type === "task.update" && b.type === "task.update")
    return a.taskId === b.taskId && sameKeys(a.patch, b.patch) && !("status" in b.patch);
  if (a.type === "project.update" && b.type === "project.update")
    return a.projectId === b.projectId && sameKeys(a.patch, b.patch) && !("status" in b.patch);
  return false;
}

export const sync = new Sync();
