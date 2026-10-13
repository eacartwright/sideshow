import type { CompanyInfo } from "@sideshow/shared";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./sync";

// CW's companies for the company picker (DESIGN.md §10), fetched from the server, which keeps
// them up to date. Kept in localStorage too, so the picker works offline and opens instantly.

export interface CompaniesSnapshot {
  companies: CompanyInfo[];
  byId: Map<number, CompanyInfo>;
  /** When the server last synced with CW; null if never. */
  syncedAt: number | null;
  /** A fetch or a refresh is under way. */
  busy: boolean;
  /** The server is syncing with CW (the first sync takes a minute or two). */
  syncing: boolean;
  /** How far the first sync has got, while it runs. */
  progress: { done: number; total: number } | null;
  error: string | null;
}

const KEY = "sideshow:cwCompanies";

function load(): Pick<CompaniesSnapshot, "companies" | "syncedAt"> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // No storage (private mode): start empty.
  }
  return { companies: [], syncedAt: null };
}

const cached = load();
let snap: CompaniesSnapshot = {
  ...cached,
  byId: new Map(cached.companies.map((c) => [c.id, c])),
  busy: false,
  syncing: false,
  progress: null,
  error: null,
};
const listeners = new Set<() => void>();
let fetched = false;
/** The one pending "ask again" while the server syncs. */
let poll: ReturnType<typeof setTimeout> | undefined;

function set(patch: Partial<CompaniesSnapshot>) {
  snap = { ...snap, ...patch };
  if (patch.companies) {
    snap.byId = new Map(patch.companies.map((c) => [c.id, c]));
    try {
      localStorage.setItem(KEY, JSON.stringify({ companies: snap.companies, syncedAt: snap.syncedAt }));
    } catch {
      // Full or blocked: the copy in memory still works.
    }
  }
  for (const fn of listeners) fn();
}

async function request(path: string, init?: RequestInit) {
  set({ busy: true });
  try {
    const res = await api(path, init);
    const body = (await res.json()) as {
      companies: CompanyInfo[];
      syncedAt: number | null;
      syncing: boolean;
      progress: { done: number; total: number } | null;
      error: string | null;
    };
    set({ companies: body.companies, syncedAt: body.syncedAt, syncing: body.syncing, progress: body.progress ?? null, busy: false, error: body.error });
    // While the server syncs, ask again shortly: for its progress, then the finished list.
    clearTimeout(poll);
    if (body.syncing) poll = setTimeout(() => void request("/api/cw/companies"), 3_000);
  } catch {
    set({ busy: false, error: "Couldn't reach the server" });
  }
}

/** Fetch once per page load (the picker calls this when it opens). */
export function ensureCompanies() {
  if (fetched) return;
  fetched = true;
  void request("/api/cw/companies");
}

/** Ask the server to sync with CW now (the answer comes once it's done). */
export function refreshCompanies(full = false) {
  set({ syncing: true });
  return request(`/api/cw/companies/refresh${full ? "?full=1" : ""}`, { method: "POST" });
}

/** "Syncing ConnectWise companies… 312 of 745", or null when no sync is running. */
export function syncText(s: CompaniesSnapshot): string | null {
  if (!s.syncing) return null;
  return `Syncing ConnectWise companies…${s.progress ? ` ${s.progress.done} of ${s.progress.total}` : ""}`;
}

export function getCompanies() {
  return snap;
}

/** The cached companies; fetches them the first time, if `on` (CW is set up). */
export function useCompanies(on: boolean): CompaniesSnapshot {
  useEffect(() => {
    if (on) ensureCompanies();
  }, [on]);
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snap,
  );
}
