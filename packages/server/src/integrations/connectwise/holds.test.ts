import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../../db";
import { CwError, type ConnectWiseClient, type CwScheduleEntryInput } from "./client";
import { dateIn, parseRule, ScheduleHolds, zonedTime, type HoldRule } from "./holds";

const dirs: string[] = [];
const dbs: { close(): void }[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TZ = "America/New_York";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Thursday 2026-10-29, 3 PM in New York (EDT, UTC-4). Clocks go back on Sunday 2026-11-01.
const NOW = Date.UTC(2026, 9, 29, 19);

const RULE: HoldRule = {
  name: "End of day time entries",
  days: [1, 2, 3, 4, 5],
  start: "16:00",
  end: "17:00",
  from: "2026-10-29",
  until: null,
  reminder: 15,
  timeZone: TZ,
};

/** CW as far as holds go: its lookups as on the live instance, and a calendar. */
function fakeCw() {
  let nextId = 93100;
  const entries = new Map<number, CwScheduleEntryInput & { id: number }>();
  const calls: string[] = [];
  const state = { down: false };
  const up = () => {
    if (state.down) throw new TypeError("fetch failed");
  };
  const cw = {
    getScheduleTypes: async () => [
      { id: 4, name: "Service" },
      { id: 13, name: "Schedule Hold" },
    ],
    getScheduleStatuses: async () => [
      { id: 1, name: "Tentative" },
      { id: 2, name: "Firm" },
    ],
    getServiceLocations: async () => [
      { id: 2, name: "In-house" },
      { id: 4, name: "Remote" },
    ],
    getReminderTimes: async () => [0, 5, 10, 15, 30].map((time, i) => ({ id: i + 1, time, name: `${time} minutes` })),
    createScheduleEntry: async (e: CwScheduleEntryInput) => {
      up();
      const id = nextId++;
      entries.set(id, { ...e, id });
      calls.push(`POST ${e.dateStart}`);
      return { id, name: e.name, dateStart: e.dateStart, dateEnd: e.dateEnd };
    },
    updateScheduleEntry: async (id: number, values: Partial<CwScheduleEntryInput>) => {
      up();
      const e = entries.get(id);
      if (!e) throw new CwError(404, '{"code":"NotFound"}', "PATCH", `/schedule/entries/${id}`);
      Object.assign(e, values);
      calls.push(`PATCH ${id} ${JSON.stringify(values)}`);
      return e;
    },
    deleteScheduleEntry: async (id: number) => {
      up();
      if (!entries.delete(id)) throw new CwError(404, '{"code":"NotFound"}', "DELETE", `/schedule/entries/${id}`);
      calls.push(`DELETE ${id}`);
    },
  };
  return { cw: cw as unknown as ConnectWiseClient, entries, calls, state };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-holds-"));
  dirs.push(dir);
  const db = openDb(join(dir, "t.db"));
  dbs.push(db);
  const fake = fakeCw();
  const holds = new ScheduleHolds(db, fake.cw, "ecartwright", () => {});
  const starts = () => [...fake.entries.values()].map((e) => e.dateStart).sort();
  return { db, holds, ...fake, starts };
}

describe("times in a time zone", () => {
  it("finds the instant of a wall-clock time, either side of a DST change", () => {
    expect(new Date(zonedTime("2026-10-30", "16:00", TZ)).toISOString()).toBe("2026-10-30T20:00:00.000Z");
    expect(new Date(zonedTime("2026-11-02", "16:00", TZ)).toISOString()).toBe("2026-11-02T21:00:00.000Z");
    expect(new Date(zonedTime("2026-11-02", "00:30", TZ)).toISOString()).toBe("2026-11-02T05:30:00.000Z");
  });

  it("says what date it is there", () => {
    expect(dateIn(NOW, TZ)).toBe("2026-10-29");
    // 9 PM in New York is the next day in UTC.
    expect(dateIn(Date.UTC(2026, 9, 30, 1), TZ)).toBe("2026-10-29");
  });
});

describe("parseRule", () => {
  it("takes a hold as the app sends it", () => {
    expect(parseRule({ ...RULE, name: "  End of day  ", days: [5, 1, 3, 1] })).toEqual({ ...RULE, name: "End of day", days: [1, 3, 5] });
  });

  it("says what's wrong", () => {
    expect(parseRule({ ...RULE, name: " " })).toEqual({ error: "A description is needed" });
    expect(parseRule({ ...RULE, days: [] })).toEqual({ error: "Pick at least one day" });
    expect(parseRule({ ...RULE, days: [7] })).toEqual({ error: "Pick at least one day" });
    expect(parseRule({ ...RULE, end: "15:00" })).toEqual({ error: "The end has to be after the start" });
    expect(parseRule({ ...RULE, start: "4pm" })).toEqual({ error: "Start and end times are needed" });
    expect(parseRule({ ...RULE, from: "2026-02-30" })).toEqual({ error: "A start date is needed" });
    expect(parseRule({ ...RULE, until: "2026-10-01" })).toEqual({ error: "The end date has to be on or after the start date" });
    expect(parseRule({ ...RULE, timeZone: "Mars/Olympus" })).toEqual({ error: "Not a time zone" });
    expect(parseRule({ ...RULE, timeZone: undefined })).toEqual({ error: "Not a time zone" });
  });
});

describe("schedule holds", () => {
  it("makes an entry for each weekday of the next four weeks, as a Firm, In-house Schedule Hold", async () => {
    const { holds, entries, starts } = setup();
    await holds.create(RULE, NOW);
    // Thu Oct 29 to Wed Nov 25: 20 weekdays. Today's is still to come, so it's made too.
    expect(entries.size).toBe(20);
    expect(starts()[0]).toBe("2026-10-29T20:00:00Z");
    expect(starts()[2]).toBe("2026-11-02T21:00:00Z");
    expect(starts().at(-1)).toBe("2026-11-25T21:00:00Z");
    expect([...entries.values()][0]).toEqual({
      id: 93100,
      name: "End of day time entries",
      member: { identifier: "ecartwright" },
      type: { id: 13 },
      status: { id: 2 },
      where: { id: 2 },
      dateStart: "2026-10-29T20:00:00Z",
      dateEnd: "2026-10-29T21:00:00Z",
      reminder: { id: 4 },
      allowScheduleConflictsFlag: true,
    });
    const [view] = holds.list(NOW);
    expect(view!.upcoming.length).toBe(20);
    expect(view!.upcoming.every((d) => d.state === "made")).toBe(true);
    expect(view!.error).toBeNull();
  });

  it("doesn't make today's once it has started, or one with no reminder", async () => {
    const { holds, entries, starts } = setup();
    await holds.create({ ...RULE, reminder: null }, NOW + 1.5 * HOUR);
    expect(starts()[0]).toBe("2026-10-30T20:00:00Z");
    expect(entries.size).toBe(19);
    expect("reminder" in [...entries.values()][0]!).toBe(false);
    expect(holds.list(NOW + 1.5 * HOUR)[0]!.upcoming[0]!.date).toBe("2026-10-30");
  });

  it("keeps four weeks ahead as days pass, and makes each day once", async () => {
    const { holds, entries, calls } = setup();
    await holds.create(RULE, NOW);
    await holds.sync(NOW + HOUR);
    expect(calls.length).toBe(20);
    // Thursday Nov 26 comes into the window a day later.
    await holds.sync(NOW + DAY);
    expect(entries.size).toBe(21);
    expect(calls.at(-1)).toBe("POST 2026-11-26T21:00:00Z");
  });

  it("stops at the end date", async () => {
    const { holds, entries } = setup();
    await holds.create({ ...RULE, until: "2026-11-03" }, NOW);
    expect(entries.size).toBe(4);
    await holds.sync(NOW + 7 * DAY);
    expect(entries.size).toBe(4);
  });

  it("changes the entries still to come when the hold changes, and leaves earlier ones", async () => {
    const { holds, entries, calls, starts } = setup();
    const id = await holds.create(RULE, NOW);
    calls.length = 0;
    // Friday 10 AM: Thursday's is over; from Friday on, 3:30–4:30 and no reminder.
    const later = Date.UTC(2026, 9, 30, 14);
    await holds.update(id, { ...RULE, start: "15:30", end: "16:30", reminder: null }, later);
    expect(starts()[0]).toBe("2026-10-29T20:00:00Z");
    expect(starts()[1]).toBe("2026-10-30T19:30:00Z");
    // 19 changed; and a day later, Thursday Nov 26 is in the window.
    expect(calls.filter((c) => c.startsWith("PATCH")).length).toBe(19);
    expect(calls.at(-1)).toBe("POST 2026-11-26T20:30:00Z");
    expect(calls[0]).toBe('PATCH 93101 {"dateStart":"2026-10-30T19:30:00Z","dateEnd":"2026-10-30T20:30:00Z","reminder":null}');
    // Only what changed is sent.
    calls.length = 0;
    await holds.update(id, { ...RULE, name: "EOD", start: "15:30", end: "16:30", reminder: null }, later);
    expect(calls[0]).toBe('PATCH 93101 {"name":"EOD"}');
    expect(entries.get(93101)!.name).toBe("EOD");
    expect(entries.get(93100)!.name).toBe("End of day time entries");
  });

  it("removes the days a changed hold no longer covers, and adds new ones", async () => {
    const { holds, entries, calls } = setup();
    const id = await holds.create(RULE, NOW);
    calls.length = 0;
    // Mondays to Thursdays only: the four Fridays go.
    await holds.update(id, { ...RULE, days: [1, 2, 3, 4] }, NOW);
    expect(calls.filter((c) => c.startsWith("DELETE")).length).toBe(4);
    expect(entries.size).toBe(16);
    // Saturdays too: four are added.
    await holds.update(id, { ...RULE, days: [1, 2, 3, 4, 6] }, NOW);
    expect(entries.size).toBe(20);
  });

  it("doesn't make a day again once it's skipped, or deleted in CW", async () => {
    const { holds, entries } = setup();
    const id = await holds.create(RULE, NOW);
    expect(await holds.skip(id, "2026-11-11", true, NOW)).toBeNull();
    expect(entries.size).toBe(19);
    // Deleted in CW: found out when the hold changes, and left alone.
    entries.delete(93102);
    await holds.update(id, { ...RULE, name: "EOD" }, NOW);
    await holds.sync(NOW + HOUR);
    expect(entries.size).toBe(18);
    const days = holds.list(NOW)[0]!.upcoming;
    expect(days.find((d) => d.date === "2026-11-11")!.state).toBe("skipped");
    expect(days.find((d) => d.date === "2026-11-02")!.state).toBe("gone");
    // Either can be made again.
    await holds.skip(id, "2026-11-11", false, NOW);
    await holds.skip(id, "2026-11-02", false, NOW);
    expect(entries.size).toBe(20);
    expect(holds.list(NOW)[0]!.upcoming.every((d) => d.state === "made")).toBe(true);
  });

  it("won't skip one that has started", async () => {
    const { holds } = setup();
    const id = await holds.create(RULE, NOW);
    expect(await holds.skip(id, "2026-10-29", true, NOW + 1.5 * HOUR)).toBe("That one has started already");
  });

  it("deletes the entries still to come with the hold, and leaves earlier ones", async () => {
    const { holds, entries, starts } = setup();
    const id = await holds.create(RULE, NOW);
    await holds.remove(id, NOW + 2 * HOUR);
    expect(starts()).toEqual(["2026-10-29T20:00:00Z"]);
    expect(holds.list(NOW)).toEqual([]);
  });

  it("says why when CW can't be reached, and catches up on the next pass", async () => {
    const { holds, entries, state } = setup();
    state.down = true;
    const id = await holds.create(RULE, NOW);
    let [view] = holds.list(NOW);
    expect(view!.error).toBe("ConnectWise didn't answer");
    expect(view!.upcoming.length).toBe(20);
    expect(view!.upcoming.every((d) => d.state === "waiting")).toBe(true);
    state.down = false;
    await holds.sync(NOW);
    [view] = holds.list(NOW);
    expect(view!.error).toBeNull();
    expect(entries.size).toBe(20);

    // A delete that can't reach CW keeps the hold, marked, until its entries are gone.
    state.down = true;
    await holds.remove(id, NOW);
    [view] = holds.list(NOW);
    expect(view!.removed).toBe(true);
    expect(view!.error).toBe("ConnectWise didn't answer");
    expect(await holds.update(id, RULE, NOW)).toBe(false);
    state.down = false;
    await holds.sync(NOW);
    expect(holds.list(NOW)).toEqual([]);
    expect(entries.size).toBe(0);
  });

  it("says so when CW has no Schedule Hold type", async () => {
    const { holds, cw, entries } = setup();
    (cw as any).getScheduleTypes = async () => [{ id: 4, name: "Service" }];
    await holds.create(RULE, NOW);
    expect(holds.list(NOW)[0]!.error).toBe('ConnectWise has no schedule type named "Schedule Hold"');
    expect(entries.size).toBe(0);
  });
});
