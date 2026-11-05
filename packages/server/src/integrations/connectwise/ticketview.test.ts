import { describe, expect, it } from "vitest";
import { CwError, type ConnectWiseClient, type CwTicketDetail, type CwTicketNoteDetail, type CwTimeEntryDetail } from "./client";
import { ticketView } from "./ticketview";

const ticket: CwTicketDetail = {
  id: 7,
  summary: "Printer",
  company: { id: 1, name: "Acme" },
  board: { id: 1, name: "Tier 1" },
  status: { id: 2, name: "In Progress" },
  type: { id: 1, name: "Hardware" },
  subType: { id: 2, name: "Printer" },
  contactName: "Dana",
  contactEmailAddress: "dana@example.com",
  resources: "tom, ecartwright",
};
const note = (id: number, at: string, extra: Partial<CwTicketNoteDetail> = {}): CwTicketNoteDetail => ({
  id,
  ticketId: 7,
  text: `note ${id}`,
  dateCreated: at,
  member: { id: 1, name: "Tom" },
  ...extra,
});
const time = (id: number, at: string, extra: Partial<CwTimeEntryDetail> = {}): CwTimeEntryDetail => ({
  id,
  chargeToId: 7,
  chargeToType: "ServiceTicket",
  timeStart: at,
  timeEnd: at,
  notes: `entry ${id}`,
  actualHours: 1.5,
  member: { id: 2, name: "Evan" },
  workType: { id: 3, name: "Remote" },
  addToInternalAnalysisFlag: true,
  ...extra,
});
const fake = (t: () => Promise<CwTicketDetail>, notes: () => Promise<CwTicketNoteDetail[]>, entries: () => Promise<CwTimeEntryDetail[]>) => {
  const asked: string[] = [];
  const cw = {
    getTicket: t,
    ticketNoteList: (kind: string) => {
      asked.push(`notes:${kind}`);
      return notes();
    },
    ticketTimeEntries: (kind: string) => {
      asked.push(`time:${kind}`);
      return entries();
    },
  } as unknown as ConnectWiseClient;
  return { cw, asked };
};

describe("ticketView", () => {
  it("has the details, the oldest Discussion note as description, the rest newest first", async () => {
    const { cw } = fake(
      async () => ticket,
      async () => [
        note(2, "2026-11-02T10:00:00Z", { detailDescriptionFlag: true }),
        note(1, "2026-11-01T10:00:00Z", { detailDescriptionFlag: true, text: "It's jammed" }),
        note(3, "2026-11-03T10:00:00Z", { internalAnalysisFlag: true }),
      ],
      async () => [time(9, "2026-11-02T15:00:00Z")],
    );
    const v = (await ticketView(cw, 7))!;
    expect(v).toMatchObject({ kind: "service", company: "Acme", type: "Hardware › Printer", contact: { name: "Dana", email: "dana@example.com" }, resources: ["tom", "ecartwright"], description: "It's jammed" });
    expect(v.activity.map((a) => a.id)).toEqual(["n3", "t9", "n2"]);
    expect(v.activity[0]).toMatchObject({ kind: "note", who: "Tom", where: ["Internal"] });
    expect(v.activity[1]).toMatchObject({ kind: "time", who: "Evan", hours: 1.5, workType: "Remote", where: ["Internal"], text: "entry 9" });
    expect(v.note).toBeUndefined();
  });

  it("doesn't take an internal note for the description", async () => {
    const { cw } = fake(async () => ticket, async () => [note(1, "2026-11-01T10:00:00Z", { internalAnalysisFlag: true })], async () => []);
    const v = (await ticketView(cw, 7))!;
    expect(v.description).toBeUndefined();
    expect(v.activity).toHaveLength(1);
  });

  it("reads a project ticket's notes and time as a project ticket's", async () => {
    const { cw, asked } = fake(async () => ({ ...ticket, recordType: "ProjectTicket", project: { id: 1, name: "Refresh" }, phase: { id: 2, name: "Delivery" } }), async () => [], async () => []);
    const v = (await ticketView(cw, 7))!;
    expect(v).toMatchObject({ kind: "project", project: "Refresh", phase: "Delivery" });
    expect(asked).toEqual(["notes:project", "time:project"]);
  });

  it("still shows the ticket when its notes or time can't be read, and says so", async () => {
    const no = async () => Promise.reject(new CwError(403, "denied", "GET", "/x"));
    const onlyTime = (await ticketView(fake(async () => ticket, no, async () => [time(9, "2026-11-02T15:00:00Z")]).cw, 7))!;
    expect(onlyTime.activity.map((a) => a.id)).toEqual(["t9"]);
    expect(onlyTime.note).toContain("notes");
    const neither = (await ticketView(fake(async () => ticket, no, no).cw, 7))!;
    expect(neither.summary).toBe("Printer");
    expect(neither.note).toContain("notes");
    expect(neither.note).toContain("time entries");
  });

  it("says no such ticket with null, and passes on other failures", async () => {
    expect(await ticketView(fake(async () => Promise.reject(new CwError(404, "", "GET", "/x")), async () => [], async () => []).cw, 7)).toBeNull();
    await expect(ticketView(fake(async () => Promise.reject(new CwError(500, "", "GET", "/x")), async () => [], async () => []).cw, 7)).rejects.toThrow();
  });
});
