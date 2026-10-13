import { useEffect, useSyncExternalStore } from "react";
import { api } from "./sync";

// This week's recurring internal ticket (the WRIT, DESIGN.md §10), as the server last found
// it. Kept in localStorage so ▶ WRIT works at once (it must focus the notes inside the tap, so
// it can't wait for a request) and offline. Asked for again on load and hourly.

export interface WeeklyTicket {
  ticket: number;
  summary: string;
  enteredAt: number;
}

const KEY = "sideshow:cwWeekly";
const listeners = new Set<() => void>();
let current: WeeklyTicket | null = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as WeeklyTicket | null;
  } catch {
    return null;
  }
})();
let started = false;

async function fetchWeekly(refresh = false) {
  try {
    const res = await api(refresh ? "/api/cw/weekly/refresh" : "/api/cw/weekly", refresh ? { method: "POST" } : undefined);
    const { weekly } = (await res.json()) as { weekly: WeeklyTicket | null };
    if (!weekly || weekly.ticket === current?.ticket) return;
    current = weekly;
    try {
      localStorage.setItem(KEY, JSON.stringify(weekly));
    } catch {
      // Kept in memory for this visit.
    }
    for (const fn of listeners) fn();
  } catch {
    // Offline or not set up: keep what we had.
  }
}

export function getWeekly(): WeeklyTicket | null {
  return current;
}

/** Ask the server again now (▶ WRIT when it knows of none yet). */
export const refreshWeekly = () => fetchWeekly(true);

/** This week's ticket; starts asking the server (on load, then hourly) when `on`. */
export function useWeekly(on: boolean): WeeklyTicket | null {
  useEffect(() => {
    if (!on || started) return;
    started = true;
    void fetchWeekly();
    setInterval(() => void fetchWeekly(), 3_600_000);
  }, [on]);
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
