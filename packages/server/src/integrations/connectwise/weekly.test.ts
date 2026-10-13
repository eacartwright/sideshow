import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../../db";
import type { ConnectWiseClient } from "./client";
import { WeeklyTickets } from "./weekly";

const dirs: string[] = [];
const dbs: { close(): void }[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const DAY = 86_400_000;
const MON = Date.UTC(2026, 9, 12, 6, 15);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-weekly-"));
  dirs.push(dir);
  const db = openDb(join(dir, "t.db"));
  dbs.push(db);
  // CW as it is: a ticket per week, newest first; last week's still open.
  const tickets = [
    { id: 106566, summary: "Weekly Recurring Internal Ticket - Evan Cartwright", _info: { dateEntered: new Date(MON - 7 * DAY).toISOString() } },
  ];
  const asked: string[] = [];
  const cw = {
    newestTicket: async (conditions: string) => {
      asked.push(conditions);
      return [...tickets].sort((a, b) => b.id - a.id)[0] ?? null;
    },
  } as unknown as ConnectWiseClient;
  const weekly = new WeeklyTickets(db, cw, "ecartwright", async () => "Weekly Recurring Internal Ticket - Evan Cartwright", () => {});
  return { db, weekly, tickets, asked };
}

describe("the weekly recurring ticket", () => {
  it("finds the newest by summary and owner, and keeps it", async () => {
    const { weekly, tickets, asked } = setup();
    tickets.push({ id: 107152, summary: "Weekly Recurring Internal Ticket - Evan Cartwright", _info: { dateEntered: new Date(MON).toISOString() } });
    expect(await weekly.check()).toEqual({ ticket: 107152, summary: "Weekly Recurring Internal Ticket - Evan Cartwright", enteredAt: MON });
    expect(asked[0]).toBe('summary="Weekly Recurring Internal Ticket - Evan Cartwright" and owner/identifier="ecartwright"');
    expect(weekly.current()?.ticket).toBe(107152);
  });

  it("only asks CW again once the known one is about a week old", async () => {
    const { weekly, asked, tickets } = setup();
    tickets.push({ id: 107152, summary: "x", _info: { dateEntered: new Date(MON).toISOString() } });
    await weekly.check(MON + 60_000);
    const first = asked.length;
    weekly.checkIfDue(MON + 3 * DAY);
    expect(asked.length).toBe(first);
    // Next Monday: due, but not more than once an hour.
    weekly.checkIfDue(MON + 7 * DAY + 10 * 60_000);
    await new Promise((r) => setTimeout(r, 0));
    weekly.checkIfDue(MON + 7 * DAY + 20 * 60_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(asked.length).toBe(first + 1);
    weekly.checkIfDue(MON + 7 * DAY + 80 * 60_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(asked.length).toBe(first + 2);
  });

  it("keeps what it knew when CW can't be reached", async () => {
    const { weekly } = setup();
    await weekly.check();
    (weekly as any).cw = { newestTicket: async () => Promise.reject(new Error("ConnectWise GET → 500")) };
    expect((await weekly.check())?.ticket).toBe(106566);
  });
});
