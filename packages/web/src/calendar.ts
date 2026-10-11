import type { Ms, Session } from "@sideshow/shared";

// Layout for the Day page's calendar (components/DayCalendar.tsx), kept free of React so it
// can be tested on its own.

/** Shorter gaps aren't worth shading (switching tasks takes a moment). */
const MIN_GAP = 5 * 60_000;

export interface Placed {
  session: Session;
  start: Ms;
  end: Ms;
  col: number;
  cols: number;
}

/**
 * Lay out overlapping sessions in columns, like a calendar's overlapping meetings: each cluster
 * of sessions that overlap one another (directly or through a chain) shares its width equally.
 */
export function placeBlocks(spans: { session: Session; start: Ms; end: Ms }[]): Placed[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let colEnds: Ms[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const p of cluster) p.cols = colEnds.length;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
  };
  for (const s of sorted) {
    if (s.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= s.start);
    if (col < 0) col = colEnds.push(s.end) - 1;
    else colEnds[col] = s.end;
    cluster.push({ ...s, col, cols: 0 });
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  flush();
  return out;
}

/** Stretches between `from` and `to` that no span covers, at least MIN_GAP long. */
export function findGaps(spans: { start: Ms; end: Ms }[]): { start: Ms; end: Ms }[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const gaps: { start: Ms; end: Ms }[] = [];
  let reach = sorted[0]?.end ?? 0;
  for (const s of sorted.slice(1)) {
    if (s.start - reach >= MIN_GAP) gaps.push({ start: reach, end: s.start });
    reach = Math.max(reach, s.end);
  }
  return gaps;
}

export type DragMode = "move" | "start" | "end";

/**
 * Where a dragged session lands. `delta` is how far the pointer moved, in ms. The moved edge
 * (or, for a move, the start) snaps to `step` from midnight; the session stays at least one
 * step long and within the day; a running session's start can't pass now.
 */
export function dragTimes(o: {
  mode: DragMode;
  start: Ms;
  end: Ms;
  delta: number;
  step: number;
  day: Ms;
  dayEnd: Ms;
  now: Ms;
  running: boolean;
}): { start: Ms; end: Ms } {
  const snap = (t: Ms) => o.day + Math.round((t - o.day) / o.step) * o.step;
  const clamp = (t: Ms, lo: Ms, hi: Ms) => Math.min(Math.max(t, lo), hi);
  if (o.mode === "move") {
    const length = o.end - o.start;
    const start = clamp(snap(o.start + o.delta), o.day, o.dayEnd - length);
    return { start, end: start + length };
  }
  if (o.mode === "start") {
    const latest = o.running ? Math.min(o.end, o.now) : o.end - o.step;
    return { start: clamp(snap(o.start + o.delta), o.day, latest), end: o.end };
  }
  return { start: o.start, end: clamp(snap(o.end + o.delta), o.start + o.step, o.dayEnd) };
}

/**
 * The span a drag across empty calendar space covers: both ends snapped to `step` from
 * midnight, either direction, at least one step long, within the day.
 */
export function spanFromDrag(o: { from: Ms; to: Ms; step: number; day: Ms; dayEnd: Ms }): { start: Ms; end: Ms } {
  const snap = (t: Ms) => o.day + Math.round((t - o.day) / o.step) * o.step;
  let start = Math.max(o.day, snap(Math.min(o.from, o.to)));
  let end = Math.min(o.dayEnd, snap(Math.max(o.from, o.to)));
  if (end - start < o.step) {
    end = Math.min(o.dayEnd, start + o.step);
    start = end - o.step;
  }
  return { start, end };
}
