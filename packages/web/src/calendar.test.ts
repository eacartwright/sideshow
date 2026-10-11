import type { Session } from "@sideshow/shared";
import { describe, expect, it } from "vitest";
import { findGaps, placeBlocks } from "./calendar";

const MIN = 60_000;
const span = (id: string, start: number, end: number) => ({ session: { id } as Session, start: start * MIN, end: end * MIN });
const layout = (spans: ReturnType<typeof span>[]) =>
  Object.fromEntries(placeBlocks(spans).map((p) => [p.session.id, `${p.col}/${p.cols}`]));

describe("placeBlocks", () => {
  it("gives separate sessions the full width", () => {
    expect(layout([span("a", 0, 60), span("b", 60, 90)])).toEqual({ a: "0/1", b: "0/1" });
  });
  it("puts overlapping sessions side by side", () => {
    expect(layout([span("a", 0, 60), span("b", 30, 90)])).toEqual({ a: "0/2", b: "1/2" });
  });
  it("shares columns across a chain of overlaps and reuses freed columns", () => {
    // a overlaps b, b overlaps c, a and c don't: two columns, c reuses a's.
    expect(layout([span("a", 0, 60), span("b", 30, 120), span("c", 60, 90)])).toEqual({ a: "0/2", b: "1/2", c: "0/2" });
  });
});

describe("findGaps", () => {
  it("finds stretches between sessions, ignoring short ones and overlaps", () => {
    const gaps = findGaps([
      { start: 0, end: 60 * MIN },
      { start: 62 * MIN, end: 90 * MIN }, // 2 min after: too short to count
      { start: 30 * MIN, end: 100 * MIN }, // overlaps, reaches further
      { start: 130 * MIN, end: 140 * MIN },
    ]);
    expect(gaps).toEqual([{ start: 100 * MIN, end: 130 * MIN }]);
  });
});
