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
