import { durationMs, type Id, type Ms, type Session } from "@sideshow/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { dragTimes, findGaps, placeBlocks, spanFromDrag, type DragMode } from "../calendar";
import { hm, timeOfDay } from "../format";
import { sessionFieldTexts, useA, useM } from "../model";
import { showToast } from "../toast";

// One day as a vertical timeline (DESIGN.md §7, Day page): a block per session, concurrent ones
// side by side, the stretches between the first and last session shaded as gaps. Click a block
// to select it (its table row highlights), double-click to open the task. With a mouse or pen,
// drag a block to move it or its top/bottom edge to resize it: 15-minute steps, Alt for 1
// minute, Esc cancels, and the drop offers Undo. Drag across empty space to add time there:
// the switcher opens to pick a task or name a new one. (Touch only selects and scrolls for now.)

const MIN = 60_000;
const HOUR = 3_600_000;
const PX_PER_HOUR = 64;
const px = (ms: number) => (ms / HOUR) * PX_PER_HOUR;
/** How far the pointer must move before a press becomes a drag (so a click still selects). */
const DRAG_THRESHOLD = 4;

interface Drag {
  id: Id;
  mode: DragMode;
  /** Pointer position and the session's times when the press began. */
  y: number;
  start: Ms;
  end: Ms;
  running: boolean;
  /** Moving an entered session un-enters it; Undo puts that back too. */
  enteredAt: Ms | null;
  moved: boolean;
  /** Where it would land now. */
  to: { start: Ms; end: Ms };
}

/** A drag across empty space: where it began, and the span it covers so far. */
interface Sweep {
  from: Ms;
  span: { start: Ms; end: Ms } | null;
}

export function DayCalendar({
  day,
  dayEnd,
  sessions,
  now,
  selectedId,
  onSelect,
  onOpenTask,
  adding,
  onAdd,
}: {
  day: Ms;
  dayEnd: Ms;
  /** The day's sessions (any that overlap it). */
  sessions: Session[];
  now: Ms;
  selectedId: Id | null;
  onSelect: (sessionId: Id | null) => void;
  onOpenTask: (taskId: Id) => void;
  /** A span being added (its switcher is open): drawn as a placeholder block. */
  adding: { start: Ms; end: Ms } | null;
  /** A drag across empty space ended: add time over this span. */
  onAdd: (span: { start: Ms; end: Ms }) => void;
}) {
  const m = useM();
  const a = useA();
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const dragging = drag !== null;
  const grid = useRef<HTMLDivElement>(null);
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const sweepRef = useRef(sweep);
  sweepRef.current = sweep;
  const sweeping = sweep !== null;
  const hours = Math.round((dayEnd - day) / HOUR); // 23 or 25 on a DST change
  const isToday = now >= day && now < dayEnd;

  const spans = sessions.map((s) =>
    drag?.moved && drag.id === s.id
      ? { session: s, ...drag.to }
      : { session: s, start: Math.max(s.start, day), end: Math.min(s.end ?? now, dayEnd) },
  );
  const placed = placeBlocks(spans.filter((s) => s.end > s.start));
  const gaps = findGaps(spans);

  // Open on the workday, or earlier if the day started earlier.
  useLayoutEffect(() => {
    const first = Math.min(...spans.map((s) => s.start), day + 7 * HOUR);
    scroller.current?.scrollTo({ top: Math.max(0, px(first - day) - PX_PER_HOUR / 2) });
    // Only when the day changes, not on every session edit.
  }, [day]);

  // While dragging, follow the pointer anywhere on the page; Esc cancels.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dy) < DRAG_THRESHOLD) return;
      const to = dragTimes({ ...d, delta: (dy / PX_PER_HOUR) * HOUR, step: e.altKey ? MIN : 15 * MIN, day, dayEnd, now: Date.now() });
      setDrag({ ...d, moved: true, to });
    };
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      if (d?.moved) drop(d);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Before App's handler, which would otherwise leave the Day page.
      e.stopPropagation();
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key, true);
    };
  }, [dragging, day, dayEnd]);

  function drop(d: Drag) {
    const { start, end } = d.to;
    if (start === d.start && (d.running || end === d.end)) return;
    const verb = d.mode === "move" ? "Moved" : "Changed";
    a.updateSession(d.id, d.running ? { start } : { start, end });
    showToast(`${verb} to ${timeOfDay(start)}–${d.running ? "now" : timeOfDay(end)}`, {
      label: "Undo",
      run: () =>
        a.updateSession(d.id, {
          start: d.start,
          ...(d.running ? {} : { end: d.end }),
          ...(d.enteredAt ? { enteredAt: d.enteredAt } : {}),
        }),
    });
  }

  /** Press on a block (or one of its edges): a drag starts once the pointer moves. */
  function press(e: React.PointerEvent, s: Session, mode: DragMode) {
    if (e.button !== 0 || e.pointerType === "touch") return;
    // A session that runs past midnight is only partly on this day: edit it in the table.
    if (s.start < day || (s.end !== null && s.end > dayEnd)) return;
    // A running session's end is now; only its start moves.
    if (s.end === null && mode !== "start") return;
    e.stopPropagation();
    e.preventDefault(); // no text selection while dragging
    const end = s.end ?? Date.now();
    setDrag({
      id: s.id,
      mode,
      y: e.clientY,
      start: s.start,
      end,
      running: s.end === null,
      enteredAt: s.enteredAt ?? null,
      moved: false,
      to: { start: s.start, end },
    });
  }

  // A drag across empty space: follow the pointer, then hand the span to the switcher.
  const timeAt = (clientY: number) => day + ((clientY - grid.current!.getBoundingClientRect().top) / PX_PER_HOUR) * HOUR;
  useEffect(() => {
    if (!sweeping) return;
    let startY: number | null = null;
    const move = (e: PointerEvent) => {
      const sw = sweepRef.current;
      if (!sw) return;
      startY ??= e.clientY;
      if (!sw.span && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) return;
      setSweep({ ...sw, span: spanFromDrag({ from: sw.from, to: timeAt(e.clientY), step: e.altKey ? MIN : 15 * MIN, day, dayEnd }) });
    };
    const up = () => {
      const sw = sweepRef.current;
      setSweep(null);
      if (sw?.span) onAdd(sw.span);
      else onSelect(null); // a plain click on empty space clears the selection
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setSweep(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key, true);
    };
  }, [sweeping, day, dayEnd]);

  function pressEmpty(e: React.PointerEvent) {
    if (e.button !== 0 || e.pointerType === "touch" || (e.target as Element).closest(".cal-block")) return;
    e.preventDefault();
    setSweep({ from: timeAt(e.clientY), span: null });
  }

  const ghost = sweep?.span ?? adding;

  // A block selected from the table scrolls into view here.
  useEffect(() => {
    if (!selectedId) return;
    scroller.current?.querySelector(`[data-session="${selectedId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <div className={`cal ${drag?.moved ? `dragging drag-${drag.mode}` : ""} ${sweep?.span ? "sweeping" : ""}`} ref={scroller} aria-label="Day calendar">
      <div className="cal-grid" ref={grid} style={{ height: px(hours * HOUR) }} onPointerDown={pressEmpty}>
        {Array.from({ length: hours }, (_, h) => (
          <div key={h} className="cal-hour" style={{ top: px(h * HOUR) }}>
            <span className="cal-hour-label">{timeOfDay(day + h * HOUR)}</span>
          </div>
        ))}
        {gaps.map((g) => (
          <div key={g.start} className="cal-gap" style={{ top: px(g.start - day), height: px(g.end - g.start) }} title={`Gap: ${hm(g.end - g.start)}`}>
            {px(g.end - g.start) >= 18 && <span>{hm(g.end - g.start)} gap</span>}
          </div>
        ))}
        {placed.map((p) => {
          const s = p.session;
          const info = m.tasks.get(s.taskId);
          const height = px(p.end - p.start);
          const label = [info?.fieldTexts.join(" · "), ...sessionFieldTexts(m, s)].filter(Boolean).join(" · ");
          const running = s.end === null;
          const live = drag?.moved && drag.id === s.id;
          const whole = s.start >= day && (s.end === null || s.end <= dayEnd);
          return (
            <button
              key={s.id}
              type="button"
              data-session={s.id}
              className={`cal-block ${running ? "running" : ""} ${s.enteredAt ? "entered" : ""} ${selectedId === s.id ? "selected" : ""} ${height < 30 ? "tight" : ""} ${live ? "live" : ""} ${whole && !running ? "movable" : ""}`}
              style={{
                top: px(p.start - day),
                height: Math.max(height, 14),
                left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                width: `calc(${100 / p.cols}% - 4px)`,
              }}
              title={
                live
                  ? undefined
                  : `${info?.title ?? ""}\n${timeOfDay(s.start)}–${running ? "now" : timeOfDay(s.end!)} · ${hm(durationMs(s, now))}${label ? `\n${label}` : ""}` +
                    (whole ? `\n\nDrag to move${running ? " its start" : ", or drag an edge to resize"} (Alt: 1-minute steps)` : "")
              }
              onPointerDown={(e) => press(e, s, running ? "start" : "move")}
              onClick={() => onSelect(s.id)}
              onDoubleClick={() => onOpenTask(s.taskId)}
            >
              {whole && <span className="cal-handle top" onPointerDown={(e) => press(e, s, "start")} aria-hidden />}
              {whole && !running && <span className="cal-handle bottom" onPointerDown={(e) => press(e, s, "end")} aria-hidden />}
              {live && (
                <span className="cal-drag-time">
                  {timeOfDay(drag.to.start)}–{running ? "now" : timeOfDay(drag.to.end)} · {hm(drag.to.end - drag.to.start)}
                </span>
              )}
              <span className={`cal-title ${info?.titleDerived ? "derived" : ""}`}>{info?.title}</span>
              {height >= 44 && label && <span className="cal-meta">{label}</span>}
              {height >= 60 && (
                <span className="cal-meta">
                  {timeOfDay(s.start)}–{running ? "now" : timeOfDay(s.end!)} · {hm(durationMs(s, now))}
                </span>
              )}
            </button>
          );
        })}
        {ghost && (
          <div className="cal-ghost" style={{ top: px(ghost.start - day), height: px(ghost.end - ghost.start) }} aria-hidden>
            <span className="cal-drag-time">
              {timeOfDay(ghost.start)}–{timeOfDay(ghost.end)} · {hm(ghost.end - ghost.start)}
            </span>
          </div>
        )}
        {isToday && <div className="cal-now" style={{ top: px(now - day) }} aria-hidden />}
      </div>
    </div>
  );
}
