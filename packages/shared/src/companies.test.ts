import { describe, expect, it } from "vitest";
import { companyKey, markDuplicates, searchCompanies, type CompanyInfo } from "./companies";

// Records as they are in CW (2026-10-12), trimmed to what the rule reads.
const co = (id: number, name: string, types: string[], lastTicket: string | null, identifier = ""): CompanyInfo => ({
  id,
  name,
  identifier,
  status: "Active",
  types,
  lastTicket,
});

const CW = [
  co(19304, "Zen Dental Group", ["Client"], "2026-10-12", "zendentalgroup"),
  co(19650, "Zen Dental Group", ["Customer"], "2024-05-26", "ZenDentalGroup7C6"),
  // The leftover has more tickets but older ones; tickets don't count, dates do.
  co(19310, "Wayland Oral Surgery", ["Client"], "2026-09-29"),
  co(19919, "Wayland Oral Surgery", ["Customer"], "2024-06-15"),
  // A former client is still the real record of its name.
  co(19328, "Johnston Endodontics", ["Former Client"], "2025-02-17"),
  co(19746, "Johnston Endodontics, LLC", ["Customer"], "2023-12-11"),
  // Brackets vs dash, the second never used.
  co(19372, "PDA Dental Group (Reading)", ["Client"], "2026-10-12"),
  co(19578, "PDA Dental Group - Reading", ["Client"], null),
  // Neither has a ticket: the older id wins.
  co(19575, "Cugine Orthodontics-Acorn Orthodontics", ["Client"], null),
  co(19574, "Cugine Orthodontics-Acorn Orthodontics", ["Client"], null),
  co(20040, "Natick Dental ", ["Lead"], "2026-10-06"),
  co(20018, "Veritaz IT", ["Customer"], null),
  co(19300, "Veritaz IT Solutions", ["Client"], "2026-10-10", "veritasitsolutions"),
];

describe("CW duplicate companies", () => {
  const marked = new Map(markDuplicates(CW).map((c) => [c.id, c.dupOf]));

  it("keeps the record with the newest ticket and marks the rest as its duplicates", () => {
    expect(marked.get(19304)).toBeUndefined();
    expect(marked.get(19650)).toBe(19304);
    expect(marked.get(19310)).toBeUndefined();
    expect(marked.get(19919)).toBe(19310);
    expect(marked.get(19328)).toBeUndefined();
    expect(marked.get(19746)).toBe(19328);
  });

  it("matches names regardless of brackets, punctuation and Inc/LLC", () => {
    expect(companyKey("PDA Dental Group (Reading)")).toBe(companyKey("PDA Dental Group - Reading"));
    expect(companyKey("Johnston Endodontics, LLC")).toBe("johnston endodontics");
    expect(companyKey("Alper Periodontics & Implants")).toBe("alper periodontics and implants");
    expect(marked.get(19578)).toBe(19372);
  });

  it("picks the older record when none has a ticket", () => {
    expect(marked.get(19574)).toBeUndefined();
    expect(marked.get(19575)).toBe(19574);
  });

  it("leaves different names alone", () => {
    expect(marked.get(20018)).toBeUndefined();
    expect(marked.get(19300)).toBeUndefined();
  });

  it("searches without duplicates, prefix matches and clients first", () => {
    const all = markDuplicates(CW);
    expect(searchCompanies(all, "zen").map((c) => c.id)).toEqual([19304]);
    expect(searchCompanies(all, "zen", { withDuplicates: true }).map((c) => c.id)).toEqual([19304, 19650]);
    // "veritaz it" starts both; the Client comes before the Customer.
    expect(searchCompanies(all, "veritaz it").map((c) => c.id)).toEqual([19300, 20018]);
    // Every word must match, in any order, in the name or identifier.
    expect(searchCompanies(all, "reading pda").map((c) => c.id)).toEqual([19372]);
    expect(searchCompanies(all, "veritasits").map((c) => c.id)).toEqual([19300]);
  });
});
