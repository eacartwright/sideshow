import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../../db";
import type { ConnectWiseClient, CwTicketStamp } from "./client";
import { CompanyCache } from "./companies";

const dirs: string[] = [];
const dbs: { close(): void }[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A stand-in for CW with companies and tickets in memory. Counts requests. */
function fakeCw() {
  const companies = [
    { id: 1, name: "Zen Dental Group", identifier: "zendentalgroup", status: { id: 1, name: "Active" }, types: [{ id: 1, name: "Client" }] },
    { id: 2, name: "Zen Dental Group", identifier: "ZenDentalGroup7C6", status: { id: 1, name: "Active" }, types: [{ id: 2, name: "Customer" }] },
    { id: 3, name: "Natick Dental", identifier: "NatickDental", status: { id: 1, name: "Active" }, types: [{ id: 3, name: "Lead" }] },
  ];
  const tickets: Record<"service" | "project", (CwTicketStamp & { company: { id: number } })[]> = {
    service: [
      { id: 100, company: { id: 2 }, _info: { dateEntered: "2024-05-26T10:00:00Z" } },
      { id: 200, company: { id: 1 }, _info: { dateEntered: "2026-10-01T10:00:00Z" } },
    ],
    project: [{ id: 150, company: { id: 2 }, _info: { dateEntered: "2024-06-01T10:00:00Z" } }],
  };
  const calls = { latest: 0, after: 0 };
  const cw = {
    getCompanySummaries: async () => companies,
    latestTicket: async (kind: "service" | "project", conditions?: string) => {
      calls.latest++;
      const id = conditions ? Number(conditions.split("=")[1]) : null;
      const list = tickets[kind].filter((t) => id === null || t.company.id === id);
      return [...list].sort((a, b) => b.id - a.id)[0] ?? null;
    },
    ticketsAfter: async (kind: "service" | "project", after: number) => {
      calls.after++;
      return tickets[kind].filter((t) => t.id > after);
    },
  };
  return { cw: cw as unknown as ConnectWiseClient, companies, tickets, calls };
}

function cache() {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-cw-"));
  dirs.push(dir);
  const db = openDb(join(dir, "t.db"));
  dbs.push(db);
  const fake = fakeCw();
  return { ...fake, db, cache: new CompanyCache(db, fake.cw, () => {}) };
}

describe("CW company cache", () => {
  it("first sync: each company's newest ticket, duplicates marked", async () => {
    const { cache: c } = cache();
    await c.sync();
    expect(c.list()).toEqual([
      { id: 3, name: "Natick Dental", identifier: "NatickDental", status: "Active", types: ["Lead"], lastTicket: null, dupOf: undefined },
      { id: 1, name: "Zen Dental Group", identifier: "zendentalgroup", status: "Active", types: ["Client"], lastTicket: "2026-10-01", dupOf: undefined },
      { id: 2, name: "Zen Dental Group", identifier: "ZenDentalGroup7C6", status: "Active", types: ["Customer"], lastTicket: "2024-06-01", dupOf: 1 },
    ]);
    expect(c.status()).toMatchObject({ syncing: false, error: null });
    expect(c.status().syncedAt).toBeGreaterThan(0);
  });

  it("later syncs read only new tickets, and drop companies deleted in CW", async () => {
    const { cache: c, calls, tickets, companies } = cache();
    await c.sync();
    const scanned = calls.latest;
    tickets.service.push({ id: 300, company: { id: 3 }, _info: { dateEntered: "2026-10-12T15:00:00Z" } });
    companies.splice(1, 1);
    await c.sync();
    expect(calls.latest).toBe(scanned);
    expect(calls.after).toBe(2);
    expect(c.list().map((x) => [x.id, x.lastTicket, x.dupOf])).toEqual([
      [3, "2026-10-12", undefined],
      [1, "2026-10-01", undefined],
    ]);
  });

  it("joins a sync already running and records a failure", async () => {
    const { cache: c, cw } = cache();
    const [a, b] = [c.sync(), c.sync()];
    expect(a).toBe(b);
    expect(c.status().syncing).toBe(true);
    await a;
    (cw as any).getCompanySummaries = async () => {
      throw new Error("ConnectWise GET /company/companies → 401");
    };
    await c.sync();
    expect(c.status().error).toMatch(/401/);
    expect(c.list()).toHaveLength(3);
  });
});
