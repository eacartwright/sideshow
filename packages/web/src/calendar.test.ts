import type { Session } from "@sideshow/shared";
import { describe, expect, it } from "vitest";
import { dragTimes, findGaps, placeBlocks, spanFromDrag } from "./calendar";

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

describe("dragTimes", () => {
  const H = 60 * MIN;
  const base = { start: 9 * H + 7 * MIN, end: 10 * H, step: 15 * MIN, day: 0, dayEnd: 24 * H, now: 12 * H, running: false };
  it("moves a session, snapping its start and keeping its length", () => {
    expect(dragTimes({ ...base, mode: "move", delta: 20 * MIN })).toEqual({ start: 9.5 * H, end: 9.5 * H + 53 * MIN });
  });
  it("keeps a moved session inside the day", () => {
    expect(dragTimes({ ...base, mode: "move", delta: -12 * H }).start).toBe(0);
    expect(dragTimes({ ...base, mode: "move", delta: 20 * H }).end).toBe(24 * H);
  });
  it("resizes one edge, at least one step long", () => {
    expect(dragTimes({ ...base, mode: "end", delta: 40 * MIN })).toEqual({ start: base.start, end: 10.75 * H });
    expect(dragTimes({ ...base, mode: "end", delta: -2 * H }).end).toBe(base.start + 15 * MIN);
    expect(dragTimes({ ...base, mode: "start", delta: 2 * H }).start).toBe(10 * H - 15 * MIN);
  });
  it("snaps to the minute with a 1-minute step", () => {
    expect(dragTimes({ ...base, mode: "start", step: MIN, delta: -3.4 * MIN }).start).toBe(9 * H + 4 * MIN);
  });
  it("doesn't let a running session start after now", () => {
    expect(dragTimes({ ...base, mode: "start", running: true, end: 12 * H, delta: 5 * H }).start).toBe(12 * H);
  });
});

describe("spanFromDrag", () => {
  const H = 60 * MIN;
  const base = { step: 15 * MIN, day: 0, dayEnd: 24 * H };
  it("snaps both ends, dragging down or up", () => {
    expect(spanFromDrag({ ...base, from: 9 * H + 4 * MIN, to: 9 * H + 52 * MIN })).toEqual({ start: 9 * H, end: 9.75 * H });
    expect(spanFromDrag({ ...base, from: 9 * H + 52 * MIN, to: 9 * H + 4 * MIN })).toEqual({ start: 9 * H, end: 9.75 * H });
  });
  it("is at least one step long and inside the day", () => {
    expect(spanFromDrag({ ...base, from: 9 * H + 1 * MIN, to: 9 * H + 3 * MIN })).toEqual({ start: 9 * H, end: 9.25 * H });
    expect(spanFromDrag({ ...base, from: 23.9 * H, to: 25 * H })).toEqual({ start: 23.75 * H, end: 24 * H });
  });
});
