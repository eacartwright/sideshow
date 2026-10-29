import type { AiProvider, AiSettings, AiUsage, CleanupResult } from "@sideshow/shared";
import { showToast } from "./toast";

// AI note cleanup (DESIGN.md §11): the server holds the keys and the settings (one set for the
// whole server, not per workspace); these ask it. Types are in shared/src/ai.ts.

export interface AiState {
  /** Providers with a key on the server. */
  providers: AiProvider[];
  /** Models that can be used (their provider has a key). */
  models: string[];
  settings: AiSettings;
  usage: AiUsage;
}

async function call<T>(path: string, body?: unknown): Promise<T | { error: string }> {
  try {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) return { error: "Signed out: reload to sign in, then try again." };
    const b = await res.json().catch(() => ({}));
    return res.ok ? (b as T) : { error: (b as { error?: string }).error ?? "Something went wrong on the server." };
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

export const loadAi = () => call<AiState>("/api/ai");
export const saveAiSettings = (s: AiSettings) => call<AiState>("/api/ai/settings", s);
export const cleanUpNotes = (req: { notes: string; templateId?: string; model?: string; context?: string }) => call<CleanupResult>("/api/ai/cleanup", req);
export const compareModels = (req: { notes: string; templateId?: string }) =>
  call<{ results: (CleanupResult | { model: string; error: string })[] }>("/api/ai/compare", req);

/** "$0.0123" under a cent, "$1.23" above. */
export const money = (usd: number) => `$${usd < 0.01 && usd > 0 ? usd.toFixed(4) : usd.toFixed(2)}`;

/** "12.3K" */
export const tokensK = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

/** A call that crossed an alert level (or the cap) says so. */
export function aiAlert(r: { alerts?: number[] }) {
  const top = Math.max(...(r.alerts ?? []), 0);
  if (top === 100) showToast("AI: this month's cap is reached; no more calls until next month (Settings › AI)");
  else if (top) showToast(`AI: past ${top}% of this month's cap`);
}
