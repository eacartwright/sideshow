import { durationMs, type Id, type Ms, type Session } from "@sideshow/shared";
import { useEffect, useLayoutEffect, useRef } from "react";
import { findGaps, placeBlocks } from "../calendar";
import { hm, timeOfDay } from "../format";
import { sessionFieldTexts, useM } from "../model";

// One day as a vertical timeline (DESIGN.md §7, Day page): a block per session, concurrent ones
// side by side, the stretches between the first and last session shaded as gaps. Read-only for
// now: click a block to select it (its table row highlights), double-click to open the task.
// Drag to move/resize and drag-to-create come next (M3 steps 3–4).

const HOUR = 3_600_000;
const PX_PER_HOUR = 64;
const px = (ms: number) => (ms / HOUR) * PX_PER_HOUR;

export function DayCalendar({
  day,
  dayEnd,
  sessions,
  now,
  selectedId,
  onSelect,
  onOpenTask,
}: {
  day: Ms;
  dayEnd: Ms;
  /** The day's sessions (any that overlap it). */
  sessions: Session[];
  now: Ms;
  selectedId: Id | null;
  onSelect: (sessionId: Id | null) => void;
  onOpenTask: (taskId: Id) => void;
}) {
  const m = useM();
  const scroller = useRef<HTMLDivElement>(null);
  const hours = Math.round((dayEnd - day) / HOUR); // 23 or 25 on a DST change
  const isToday = now >= day && now < dayEnd;

  const spans = sessions.map((s) => ({ session: s, start: Math.max(s.start, day), end: Math.min(s.end ?? now, dayEnd) }));
  const placed = placeBlocks(spans.filter((s) => s.end > s.start));
  const gaps = findGaps(spans);

  // Open on the workday, or earlier if the day started earlier.
  useLayoutEffect(() => {
    const first = Math.min(...spans.map((s) => s.start), day + 7 * HOUR);
    scroller.current?.scrollTo({ top: Math.max(0, px(first - day) - PX_PER_HOUR / 2) });
    // Only when the day changes, not on every session edit.
  }, [day]);

  // A block selected from the table scrolls into view here.
  useEffect(() => {
    if (!selectedId) return;
    scroller.current?.querySelector(`[data-session="${selectedId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <div className="cal" ref={scroller} aria-label="Day calendar">
      <div className="cal-grid" style={{ height: px(hours * HOUR) }} onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
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
          return (
            <button
              key={s.id}
              type="button"
              data-session={s.id}
              className={`cal-block ${running ? "running" : ""} ${s.enteredAt ? "entered" : ""} ${selectedId === s.id ? "selected" : ""} ${height < 30 ? "tight" : ""}`}
              style={{
                top: px(p.start - day),
                height: Math.max(height, 14),
                left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                width: `calc(${100 / p.cols}% - 4px)`,
              }}
              title={`${info?.title ?? ""}\n${timeOfDay(s.start)}–${running ? "now" : timeOfDay(s.end!)} · ${hm(durationMs(s, now))}${label ? `\n${label}` : ""}`}
              onClick={() => onSelect(s.id)}
              onDoubleClick={() => onOpenTask(s.taskId)}
            >
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
        {isToday && <div className="cal-now" style={{ top: px(now - day) }} aria-hidden />}
      </div>
    </div>
  );
}
