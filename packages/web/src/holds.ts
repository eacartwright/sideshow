import { workspaceId } from "./workspace";

// Schedule holds (DESIGN.md §10): blocks that repeat on the CW calendar, an entry per day. The
// server keeps them, not the synced state (every change needs CW anyway), so the Holds dialog
// asks it each time it opens. Types are the server's (integrations/connectwise/holds.ts).

export interface HoldRule {
  name: string;
  /** Days of the week, 0 = Sunday. */
  days: number[];
  /** "16:00" */
  start: string;
  end: string;
  /** "2026-10-30"; no last day: it keeps going. */
  from: string;
  until: string | null;
  /** Minutes before; null: none. */
  reminder: number | null;
  timeZone: string;
}

export interface HoldDay {
  date: string;
  start: number;
  end: number;
  /** made: in CW; skipped: removed here; gone: deleted in CW; waiting: not made yet. */
  state: "made" | "skipped" | "gone" | "waiting";
  entryId: number | null;
}

export interface Hold extends HoldRule {
  id: string;
  createdAt: number;
  /** Being deleted: its entries still to come couldn't all be removed from CW yet. */
  removed: boolean;
  error: string | null;
  upcoming: HoldDay[];
}

/** How far ahead the server keeps each hold's entries (AHEAD_DAYS). */
export const AHEAD_WEEKS = 4;
/** The reminders offered: CW's, in minutes; null is none. */
export const REMINDERS: (number | null)[] = [null, 0, 5, 10, 15];

/** The holds as they are after the request; `error` if it didn't work (or a day couldn't be skipped); a new hold's `id`. */
type Answer = { holds?: Hold[]; error?: string; id?: string };

async function call(method: string, path: string, body?: unknown): Promise<Answer> {
  try {
    const res = await fetch(path, {
      method,
      headers: { "x-sideshow-workspace": workspaceId, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) return { error: "Signed out: reload to sign in, then try again." };
    const b = (await res.json().catch(() => ({}))) as Answer;
    return res.ok || b.holds ? b : { error: b.error ?? "Something went wrong on the server." };
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

export const loadHolds = () => call("GET", "/api/cw/holds");
export const saveHold = (id: string | null, rule: HoldRule) => call("POST", id ? `/api/cw/holds/${id}` : "/api/cw/holds", rule);
export const deleteHold = (id: string) => call("DELETE", `/api/cw/holds/${id}`);
export const skipHoldDay = (id: string, date: string, skip: boolean) => call("POST", `/api/cw/holds/${id}/days/${date}`, { skip });
/** Make what's missing now, instead of on the next hourly pass. */
export const syncHolds = () => call("POST", "/api/cw/holds/sync");

// ---- Labels ----

/** Monday first, as the work week reads. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayName = (d: number) => DAY_NAMES[d]!;

/** "Mon–Fri", "Mon, Wed, Fri", "Every day". */
export function daysLabel(days: number[]): string {
  if (days.length === 7) return "Every day";
  const order = WEEK.filter((d) => days.includes(d));
  const first = WEEK.indexOf(order[0]!);
  const run = order.length >= 3 && order.every((d, i) => WEEK[first + i] === d);
  return run ? `${dayName(order[0]!)}–${dayName(order.at(-1)!)}` : order.map(dayName).join(", ");
}

/** "16:00" → "4:00 PM". By hand: toLocale* puts a narrow space before PM. */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "4:00–5:00 PM", or "11:30 AM – 12:30 PM" across noon. */
export function spanLabel(start: string, end: string): string {
  const [a, b] = [timeLabel(start), timeLabel(end)];
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a} – ${b}`;
}

/** "2026-10-30" → "Fri, Oct 30". */
export function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function reminderLabel(minutes: number | null): string {
  return minutes == null ? "No reminder" : minutes === 0 ? "Reminder when it starts" : `Reminder ${minutes} min before`;
}

/** Today's date here ("2026-10-29"). */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
