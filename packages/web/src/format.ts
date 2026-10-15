import { startOfDay, type EntryFormat, type Ms } from "@sideshow/shared";

const pad = (n: number) => n.toString().padStart(2, "0");

/** 1:05:09 — for live timers. */
export function clock(ms: Ms): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 1h 05m / 25m — for totals. */
export function hm(ms: Ms): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${pad(m % 60)}m` : `${m}m`;
}

export function timeOfDay(t: Ms): string {
  return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function dayLabel(t: Ms, now: Ms = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** "10:42 AM" today, "Yesterday", or "Mon, Sep 28". */
export function whenLabel(t: Ms, now: Ms = Date.now()): string {
  return startOfDay(t) === startOfDay(now) ? timeOfDay(t) : dayLabel(t, now);
}

// Time entry formats (the profile's entryFormat). Built by hand: toLocale* puts a narrow
// no-break space before AM/PM, which pastes badly into other systems.

export function entryDate(t: Ms, format: EntryFormat["date"]): string {
  const d = new Date(t);
  const [y, m, day] = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())];
  if (format === "YYYY-MM-DD") return `${y}-${m}-${day}`;
  if (format === "DD/MM/YYYY") return `${day}/${m}/${y}`;
  return `${m}/${day}/${y}`;
}

export function entryTime(t: Ms, format: EntryFormat["time"]): string {
  const d = new Date(t);
  const h = d.getHours();
  if (format === "HH:mm") return `${pad(h)}:${pad(d.getMinutes())}`;
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/** 1.25 (decimal) or 1:15. */
export function entryHours(ms: Ms, format: EntryFormat["hours"]): string {
  if (format === "decimal") return (ms / 3_600_000).toFixed(2);
  const m = Math.max(0, Math.round(ms / 60_000));
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

/** A field label's plural: "Clients", "Companies". */
export function plural(word: string): string {
  return /[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;
}
