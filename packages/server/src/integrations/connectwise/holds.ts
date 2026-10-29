import { newId } from "@sideshow/shared";
import type { DB } from "../../db";
import { CwError, type ConnectWiseClient, type CwRef, type CwScheduleEntryInput } from "./client";
import { cwMessage } from "./push";

// Schedule holds (DESIGN.md §10): a block that repeats on the CW calendar, e.g. "End of day time
// entries", Mon–Fri 4–5 PM. CW's schedule entries don't repeat, so sideshow makes one per day
// and keeps the next AHEAD_DAYS filled as time passes (a pass on every change, and hourly).
// Each day's entry is recorded (cw_hold_days), so a day is made once: one skipped here or
// deleted in CW isn't made again. Changing or deleting a hold changes the entries that haven't
// started yet; earlier ones stay as they are.

export const AHEAD_DAYS = 28;
/** What a hold's entries are in CW. By name: ids vary per instance. */
export const HOLD_TYPE = "Schedule Hold";
export const HOLD_STATUS = "Firm";
export const HOLD_WHERE = "In-house";
export const NAME_MAX = 100;

export interface HoldRule {
  /** The entry's description on the calendar. */
  name: string;
  /** Days of the week, 0 = Sunday. */
  days: number[];
  /** "16:00", in the hold's time zone. */
  start: string;
  end: string;
  /** The first and last day ("2026-10-30"); no last day: it keeps going. */
  from: string;
  until: string | null;
  /** Minutes before; null: none. */
  reminder: number | null;
  /** Where the times are, e.g. America/New_York (the browser's). */
  timeZone: string;
}

export interface Hold extends HoldRule {
  id: string;
  createdAt: number;
  /** Being deleted: its entries still to come couldn't all be removed from CW yet. */
  removed: boolean;
  /** Why the last pass couldn't do everything, or null. */
  error: string | null;
}

/** made: in CW; skipped: removed here; gone: deleted in CW; waiting: not made yet. */
export type DayState = "made" | "skipped" | "gone" | "waiting";

export interface HoldDay {
  date: string;
  start: number;
  end: number;
  state: DayState;
  entryId: number | null;
}

/** A hold and its days from today to the end of the window. */
export interface HoldView extends Hold {
  upcoming: HoldDay[];
}

interface HoldRow {
  id: string;
  name: string;
  days: string;
  start_time: string;
  end_time: string;
  from_date: string;
  until_date: string | null;
  reminder: number | null;
  time_zone: string;
  created_at: number;
  removed: number;
  error: string | null;
}

interface DayRow {
  hold_id: string;
  date: string;
  state: Exclude<DayState, "waiting">;
  entry_id: number | null;
  sent: string | null;
}

/** What a day's entry in CW was made or last changed with. */
interface Sent {
  name: string;
  start: number;
  end: number;
  reminder: number | null;
}

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---- Dates and times in a time zone ----

const formats = new Map<string, Intl.DateTimeFormat>();
function wallClock(t: number, timeZone: string) {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formats.set(timeZone, f);
  }
  const parts = f.formatToParts(t);
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
}

/** The date ("2026-10-30") it is at `t` in a time zone. */
export function dateIn(t: number, timeZone: string): string {
  return new Date(wallClock(t, timeZone)).toISOString().slice(0, 10);
}

/** When a time ("16:00") on a date happens in a time zone. */
export function zonedTime(date: string, time: string, timeZone: string): number {
  const wall = Date.parse(`${date}T${time}:00Z`);
  // The zone's offset at that moment; asked twice in case it changes (DST) in between.
  const offset = (t: number) => wallClock(t, timeZone) - Math.floor(t / 1000) * 1000;
  return wall - offset(wall - offset(wall));
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const isDate = (s: unknown): s is string => typeof s === "string" && DATE.test(s) && addDays(s, 0) === s;
/** UTC, to the minute, as CW wants it: 2026-10-30T20:00:00Z. */
const cwTime = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A hold as the app sends it, checked; or what's wrong with it. */
export function parseRule(b: any): HoldRule | { error: string } {
  const name = typeof b?.name === "string" ? b.name.trim() : "";
  if (!name) return { error: "A description is needed" };
  if (name.length > NAME_MAX) return { error: `The description can be up to ${NAME_MAX} characters` };
  const days: unknown[] = Array.isArray(b.days) ? b.days : [];
  if (!days.length || days.some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) return { error: "Pick at least one day" };
  if (!TIME.test(b.start) || !TIME.test(b.end)) return { error: "Start and end times are needed" };
  if (b.end <= b.start) return { error: "The end has to be after the start" };
  if (!isDate(b.from)) return { error: "A start date is needed" };
  if (b.until != null && (!isDate(b.until) || b.until < b.from)) return { error: "The end date has to be on or after the start date" };
  if (b.reminder != null && (!Number.isInteger(b.reminder) || b.reminder < 0)) return { error: "Not a reminder" };
  try {
    if (typeof b.timeZone !== "string") throw new Error();
    new Intl.DateTimeFormat("en-US", { timeZone: b.timeZone });
  } catch {
    return { error: "Not a time zone" };
  }
  return {
    name,
    days: [...new Set(days as number[])].sort((x, y) => x - y),
    start: b.start,
    end: b.end,
    from: b.from,
    until: b.until ?? null,
    reminder: b.reminder ?? null,
    timeZone: b.timeZone,
  };
}

const toHold = (r: HoldRow): Hold => ({
  id: r.id,
  name: r.name,
  days: r.days.split(",").map(Number),
  start: r.start_time,
  end: r.end_time,
  from: r.from_date,
  until: r.until_date,
  reminder: r.reminder,
  timeZone: r.time_zone,
  createdAt: r.created_at,
  removed: !!r.removed,
  error: r.error,
});

/** The days a hold covers from today to the end of the window, with their times. */
function wanted(h: Hold, now: number): Map<string, { start: number; end: number }> {
  const out = new Map<string, { start: number; end: number }>();
  if (h.removed) return out;
  const today = dateIn(now, h.timeZone);
  let last = addDays(today, AHEAD_DAYS - 1);
  if (h.until && h.until < last) last = h.until;
  for (let d = h.from > today ? h.from : today; d <= last; d = addDays(d, 1)) {
    if (h.days.includes(weekday(d))) out.set(d, { start: zonedTime(d, h.start, h.timeZone), end: zonedTime(d, h.end, h.timeZone) });
  }
  return out;
}

/** CW isn't set up as a hold needs (no "Schedule Hold" type…): said as is. */
class SetupError extends Error {}

interface Lookups {
  type: number;
  status: number;
  where: number;
  /** Minutes before → CW's reminder id. */
  reminders: Map<number, number>;
}

export class ScheduleHolds {
  /** One pass or change at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  private lookups: Promise<Lookups> | null = null;

  constructor(
    private db: DB,
    private cw: ConnectWiseClient,
    /** CW_MEMBER: whose calendar. */
    private member: string,
    private log: (msg: string) => void = console.log,
  ) {}

  /** Every hold, oldest first, with its days to come. */
  list(now = Date.now()): HoldView[] {
    const rows = this.db.prepare("SELECT * FROM cw_holds ORDER BY created_at, id").all() as unknown as HoldRow[];
    return rows.map((r) => {
      const h = toHold(r);
      const today = dateIn(now, h.timeZone);
      const want = wanted(h, now);
      const days = new Map(this.days(h.id).filter((d) => d.date >= today).map((d) => [d.date, d]));
      // The days the hold covers (not today's if it was too late to make), and any entry still
      // in CW it no longer covers (not removed yet).
      const covered = [...want].filter(([date, w]) => days.has(date) || w.start > now).map(([date]) => date);
      const leftover = [...days.values()].filter((d) => d.state === "made").map((d) => d.date);
      const dates = [...new Set([...covered, ...leftover])].sort();
      const upcoming = dates.map((date): HoldDay => {
        const d = days.get(date);
        const sent = d?.sent ? (JSON.parse(d.sent) as Sent) : null;
        const times = d?.state === "made" && sent ? sent : want.get(date)!;
        return { date, start: times.start, end: times.end, state: d?.state ?? "waiting", entryId: d?.entry_id ?? null };
      });
      return { ...h, upcoming };
    });
  }

  get(id: string): Hold | null {
    const r = this.db.prepare("SELECT * FROM cw_holds WHERE id = ?").get(id) as HoldRow | undefined;
    return r ? toHold(r) : null;
  }

  /** A new hold; its entries are made right away. */
  create(rule: HoldRule, now = Date.now()): Promise<string> {
    return this.run(async () => {
      const id = newId();
      this.db
        .prepare(
          "INSERT INTO cw_holds (id, name, days, start_time, end_time, from_date, until_date, reminder, time_zone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, rule.name, rule.days.join(","), rule.start, rule.end, rule.from, rule.until, rule.reminder, rule.timeZone, now);
      await this.pass(id, now);
      return id;
    });
  }

  /** Change a hold: its entries that haven't started yet follow. False if there's no such hold. */
  update(id: string, rule: HoldRule, now = Date.now()): Promise<boolean> {
    return this.run(async () => {
      const r = this.db
        .prepare(
          "UPDATE cw_holds SET name = ?, days = ?, start_time = ?, end_time = ?, from_date = ?, until_date = ?, reminder = ?, time_zone = ? WHERE id = ? AND removed = 0",
        )
        .run(rule.name, rule.days.join(","), rule.start, rule.end, rule.from, rule.until, rule.reminder, rule.timeZone, id);
      if (!r.changes) return false;
      await this.pass(id, now);
      return true;
    });
  }

  /** Delete a hold: its entries still to come are removed from CW (then the hold goes). */
  remove(id: string, now = Date.now()): Promise<boolean> {
    return this.run(async () => {
      const r = this.db.prepare("UPDATE cw_holds SET removed = 1 WHERE id = ?").run(id);
      if (!r.changes) return false;
      await this.pass(id, now);
      return true;
    });
  }

  /**
   * Skip one day (its entry is removed from CW and not made again), or make a skipped one (or
   * one deleted in CW) again. Resolves to what's wrong, or null.
   */
  skip(id: string, date: string, skip: boolean, now = Date.now()): Promise<string | null> {
    return this.run(async () => {
      const h = this.get(id);
      if (!h || h.removed) return "No such hold";
      const day = this.days(id).find((d) => d.date === date);
      const sent = day?.sent ? (JSON.parse(day.sent) as Sent) : null;
      if (skip) {
        if (day?.state === "made" && sent && sent.start <= now) return "That one has started already";
        if (day?.state === "made" && day.entry_id != null) {
          try {
            await this.deleteEntry(day.entry_id);
          } catch (err) {
            return message(err);
          }
        }
        this.db
          .prepare("INSERT INTO cw_hold_days (hold_id, date, state) VALUES (?, ?, 'skipped') ON CONFLICT DO UPDATE SET state = 'skipped', entry_id = NULL, sent = NULL")
          .run(id, date);
      } else {
        if (day?.state === "made") return null;
        this.db.prepare("DELETE FROM cw_hold_days WHERE hold_id = ? AND date = ?").run(id, date);
        await this.pass(id, now);
      }
      return null;
    });
  }

  /** Bring every hold's entries up to date: at startup, hourly, and on "Try again". */
  sync(now = Date.now()): Promise<void> {
    return this.run(async () => {
      for (const { id } of this.db.prepare("SELECT id FROM cw_holds").all() as { id: string }[]) await this.pass(id, now);
    });
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }

  private days(holdId: string): DayRow[] {
    return this.db.prepare("SELECT * FROM cw_hold_days WHERE hold_id = ? ORDER BY date").all(holdId) as unknown as DayRow[];
  }

  /**
   * One hold against CW: entries still to come that it no longer covers are removed, ones it
   * now times or names differently are changed, and days it covers without one get one. Stops
   * at the first thing CW refuses (the rest waits for the next pass) and records why.
   */
  private async pass(id: string, now: number) {
    const h = this.get(id);
    if (!h) return;
    const want = wanted(h, now);
    let error: string | null = null;
    try {
      for (const d of this.days(id)) {
        if (d.state !== "made" || d.entry_id == null || !d.sent) continue;
        const sent = JSON.parse(d.sent) as Sent;
        // Started or over: left as it is.
        if (sent.start <= now) continue;
        const w = want.get(d.date);
        if (!w) {
          await this.deleteEntry(d.entry_id);
          this.db.prepare("DELETE FROM cw_hold_days WHERE hold_id = ? AND date = ?").run(id, d.date);
          continue;
        }
        const next: Sent = { name: h.name, start: w.start, end: w.end, reminder: h.reminder };
        if (JSON.stringify(next) === JSON.stringify(sent)) continue;
        const L = await this.resolve();
        try {
          await this.cw.updateScheduleEntry(d.entry_id, {
            ...(next.name !== sent.name ? { name: next.name } : {}),
            ...(next.start !== sent.start ? { dateStart: cwTime(next.start) } : {}),
            ...(next.end !== sent.end ? { dateEnd: cwTime(next.end) } : {}),
            ...(next.reminder !== sent.reminder ? { reminder: reminderRef(L, next.reminder) } : {}),
          });
          this.db.prepare("UPDATE cw_hold_days SET sent = ? WHERE hold_id = ? AND date = ?").run(JSON.stringify(next), id, d.date);
        } catch (err) {
          // Deleted in CW: that day is left without one.
          if (!(err instanceof CwError && err.status === 404)) throw err;
          this.db.prepare("UPDATE cw_hold_days SET state = 'gone', entry_id = NULL, sent = NULL WHERE hold_id = ? AND date = ?").run(id, d.date);
        }
      }
      const known = new Set(this.days(id).map((d) => d.date));
      for (const [date, w] of want) {
        if (known.has(date) || w.start <= now) continue;
        const L = await this.resolve();
        const sent: Sent = { name: h.name, start: w.start, end: w.end, reminder: h.reminder };
        const reminder = reminderRef(L, h.reminder);
        const entry: CwScheduleEntryInput = {
          name: h.name,
          member: { identifier: this.member },
          type: { id: L.type },
          status: { id: L.status },
          where: { id: L.where },
          dateStart: cwTime(w.start),
          dateEnd: cwTime(w.end),
          ...(reminder ? { reminder } : {}),
          allowScheduleConflictsFlag: true,
        };
        const made = await this.cw.createScheduleEntry(entry);
        this.db
          .prepare("INSERT INTO cw_hold_days (hold_id, date, state, entry_id, sent) VALUES (?, ?, 'made', ?, ?)")
          .run(id, date, made.id, JSON.stringify(sent));
      }
    } catch (err) {
      error = message(err);
      this.log(`ConnectWise hold "${h.name}": ${error}`);
    }
    if (h.removed && !error) {
      // Its entries still to come are gone: so is the hold (and its record of days).
      this.db.prepare("DELETE FROM cw_holds WHERE id = ?").run(id);
      return;
    }
    this.db.prepare("UPDATE cw_holds SET error = ? WHERE id = ?").run(error, id);
  }

  /** Removed from CW; one already deleted there is fine. */
  private async deleteEntry(entryId: number) {
    try {
      await this.cw.deleteScheduleEntry(entryId);
    } catch (err) {
      if (!(err instanceof CwError && err.status === 404)) throw err;
    }
  }

  /** CW's ids for the type, status, place and reminders, asked once (again after a failure). */
  private resolve(): Promise<Lookups> {
    this.lookups ??= (async () => {
      const byName = (list: CwRef[], name: string, what: string) => {
        const found = list.find((x) => x.name?.toLowerCase() === name.toLowerCase());
        if (!found) throw new SetupError(`ConnectWise has no ${what} named "${name}"`);
        return found.id;
      };
      const type = byName(await this.cw.getScheduleTypes(), HOLD_TYPE, "schedule type");
      const status = byName(await this.cw.getScheduleStatuses(), HOLD_STATUS, "schedule status");
      const where = byName(await this.cw.getServiceLocations(), HOLD_WHERE, "location");
      const reminders = new Map((await this.cw.getReminderTimes()).map((r) => [r.time, r.id]));
      return { type, status, where, reminders };
    })();
    this.lookups.catch(() => {
      this.lookups = null;
    });
    return this.lookups;
  }
}

function reminderRef(L: Lookups, minutes: number | null): { id: number } | null {
  if (minutes == null) return null;
  const id = L.reminders.get(minutes);
  if (id === undefined) throw new SetupError(`ConnectWise has no ${minutes}-minute reminder`);
  return { id };
}

const message = (err: unknown) => (err instanceof SetupError ? err.message : cwMessage(err));
