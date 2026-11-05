import { describe, expect, it } from "vitest";
import { CwError, type ConnectWiseClient, type CwSearchTicket } from "./client";
import { searchTickets, ticketConditions } from "./ticketsearch";

const ticket = (id: number, extra: Partial<CwSearchTicket> = {}): CwSearchTicket => ({ id, summary: `T${id}`, company: { id: 1, name: "Acme" }, ...extra });
const fake = (service: () => Promise<CwSearchTicket[]>, project: () => Promise<CwSearchTicket[]>, one?: () => Promise<CwSearchTicket>) =>
  ({
    searchTickets: (kind: "service" | "project") => (kind === "service" ? service() : project()),
    getTicket: one ?? (() => Promise.reject(new Error("unused"))),
  }) as unknown as ConnectWiseClient;

describe("ticketConditions", () => {
  it("is open tickets by default", () => {
    expect(ticketConditions("service", {})).toBe("closedFlag=false");
  });
  it("needs every word, somewhere, and searches project names on project tickets", () => {
    expect(ticketConditions("service", { q: "dock wifi" })).toBe(
      'closedFlag=false and (summary like "%dock%" or company/name like "%dock%") and (summary like "%wifi%" or company/name like "%wifi%")',
    );
    expect(ticketConditions("project", { q: "marina" })).toContain('project/name like "%marina%"');
  });
  it("narrows by company and member, and can include closed", () => {
    expect(ticketConditions("service", { companyId: 7, member: "me", closed: true })).toBe('company/id=7 and (owner/identifier="me" or resources like "%me%")');
  });
  it("escapes quotes, so a search can't change the conditions", () => {
    expect(ticketConditions("service", { q: 'a"or"b\\' })).toContain('summary like "%a\\"or\\"b\\\\%"');
  });
});

describe("searchTickets", () => {
  it("merges both kinds: open before closed, yours first, then newest", async () => {
    const cw = fake(
      async () => [ticket(1), ticket(2, { closedFlag: true, owner: { id: 1, identifier: "me" } }), ticket(3, { resources: "other, me" })],
      async () => [ticket(4, { project: { id: 9, name: "Refresh" }, phase: { id: 8, name: "Delivery" } })],
    );
    const { tickets } = await searchTickets(cw, {}, "me");
    expect(tickets.map((t) => t.id)).toEqual([3, 4, 1, 2]);
    expect(tickets[1]).toMatchObject({ kind: "project", project: "Refresh", phase: "Delivery", mine: false });
    expect(tickets[0]!.mine).toBe(true);
  });
  it("doesn't take a member with a longer name for you", async () => {
    const cw = fake(async () => [ticket(1, { resources: "mel, tom" })], async () => []);
    expect((await searchTickets(cw, {}, "me")).tickets[0]!.mine).toBe(false);
  });
  it("still answers when one kind fails, and says so", async () => {
    const cw = fake(async () => [ticket(1)], async () => Promise.reject(new CwError(400, "bad", "GET", "/project/tickets")));
    const r = await searchTickets(cw, {}, null);
    expect(r.tickets.map((t) => t.id)).toEqual([1]);
    expect(r.note).toContain("project");
  });
  it("fails when both do", async () => {
    const no = async () => Promise.reject(new CwError(500, "down", "GET", "/x"));
    await expect(searchTickets(fake(no, no), {}, null)).rejects.toThrow();
  });
  it("takes a number as that ticket, service or project", async () => {
    const cw = fake(async () => [], async () => [], async () => ticket(205001, { recordType: "ProjectTicket" }));
    expect((await searchTickets(cw, { q: "#205001" }, null)).tickets[0]).toMatchObject({ id: 205001, kind: "project" });
    const none = fake(async () => [], async () => [], async () => Promise.reject(new CwError(404, "", "GET", "/x")));
    expect((await searchTickets(none, { q: "5" }, null)).tickets).toEqual([]);
  });
});
