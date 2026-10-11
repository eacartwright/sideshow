import { readFileSync } from "node:fs";
import { emptyState, type Profile, type Session, type State } from "@sideshow/shared";
import { describe, expect, it } from "vitest";
import { timeEntryFor } from "./push";

const profile = JSON.parse(readFileSync(new URL("../../../profiles/veritaz-cw.json", import.meta.url), "utf8")) as Profile;
const T0 = Date.UTC(2026, 9, 9, 14, 26, 20); // 14:26:20 UTC
const MIN = 60_000;

function setup(session: Partial<Session> = {}, ticket = "#106745") {
  const state: State = emptyState();
  state.lists.remote = { id: "remote", list: "workTypes", name: "Remote - Business Hours", position: 0, archived: false, defaults: null, createdAt: 0, updatedAt: 0, rev: 0 };
  state.tasks.t1 = { id: "t1", title: "Firewall", fields: { ticket }, description: "", status: "open", createdAt: 0, updatedAt: 0, rev: 0 } as State["tasks"][string];
  const s: Session = {
    id: "s1",
    taskId: "t1",
    start: T0,
    end: T0 + 17 * MIN,
    deductMin: 0,
    notes: "  rebooted the firewall  ",
    fields: { workType: "remote", billing: "Billable" },
    updatedAt: 0,
    rev: 0,
    ...session,
  };
  state.sessions.s1 = s;
  return { state, s };
}
const ctx = { member: "ecartwright", ticketKind: () => "ServiceTicket" as const, workTypeId: (name: string) => (name === "Remote - Business Hours" ? 3 : undefined) };

describe("timeEntryFor", () => {
  it("builds the CW entry: minute times in UTC, the ticket, work type id, billing, internal notes, no email", () => {
    const { state, s } = setup();
    expect(timeEntryFor(s, state, profile, ctx)).toEqual({
      entry: {
        chargeToId: 106745,
        chargeToType: "ServiceTicket",
        member: { identifier: "ecartwright" },
        timeStart: "2026-10-09T14:26:00Z",
        timeEnd: "2026-10-09T14:43:00Z",
        hoursDeduct: 0,
        workType: { id: 3 },
        billableOption: "Billable",
        notes: "rebooted the firewall",
        addToDetailDescriptionFlag: false,
        addToInternalAnalysisFlag: true,
        addToResolutionFlag: false,
        emailResourceFlag: false,
        emailContactFlag: false,
        emailCcFlag: false,
      },
    });
  });

  it("sends notes to Discussion and emails when the entry says so", () => {
    const { state, s } = setup({ fields: { workType: "remote", billing: "Do Not Bill", noteTo: "Discussion" }, ext: { cw: { email: true } }, notes: "", deductMin: 15 });
    const r = timeEntryFor(s, state, profile, ctx);
    expect(r).toMatchObject({
      entry: {
        billableOption: "DoNotBill",
        notes: "Continuation of previous work",
        hoursDeduct: 0.25,
        addToDetailDescriptionFlag: true,
        addToInternalAnalysisFlag: false,
        emailContactFlag: true,
        emailCcFlag: true,
        emailResourceFlag: true,
      },
    });
  });

  it("says why it can't push", () => {
    const why = (session: Partial<Session>, ticket?: string) => {
      const { state, s } = setup(session, ticket);
      const r = timeEntryFor(s, state, profile, ctx);
      return "error" in r ? r.error : "ok";
    };
    expect(why({ end: null })).toBe("Still running: stop it first");
    expect(why({}, "")).toBe("No ticket #");
    expect(why({ fields: { billing: "Billable" } })).toBe("No work type");
    expect(why({ fields: { workType: "remote" } })).toBe("No billing");
    expect(why({ end: T0 + 5_000 })).toBe("Shorter than a minute"); // 14:26:20–14:26:25: both round to 14:26
  });

  it("reports a work type CW doesn't have", () => {
    const { state, s } = setup();
    state.lists.remote!.name = "Made up";
    expect(timeEntryFor(s, state, profile, ctx)).toEqual({ error: 'ConnectWise has no work type "Made up"' });
  });
});
