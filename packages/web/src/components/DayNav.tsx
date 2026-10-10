import { startOfDay, type Ms } from "@sideshow/shared";
import type { ReactNode } from "react";

// ‹ [date] › with a Today button when away from today. Used by Time entries' By day
// and the task list's day view. `children` go at the right end (a day total).

const pad = (n: number) => n.toString().padStart(2, "0");

/** Start of the day `n` days from `day` (safe across DST changes). */
export const addDays = (day: Ms, n: number) => startOfDay(day + n * 86_400_000 + 12 * 3_600_000);

const toInputDate = (t: Ms) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function DayNav({ day, onDay, now, children }: { day: Ms; onDay: (day: Ms) => void; now: Ms; children?: ReactNode }) {
  return (
    <div className="day-nav">
      <button className="btn icon" onClick={() => onDay(addDays(day, -1))} aria-label="Previous day">
        ‹
      </button>
      <input
        type="date"
        className="day-input"
        value={toInputDate(day)}
        onChange={(e) => {
          const [y, mo, d] = e.target.value.split("-").map(Number);
          if (y && mo && d) onDay(new Date(y, mo - 1, d).getTime());
        }}
        aria-label="Day"
      />
      <button className="btn icon" onClick={() => onDay(addDays(day, 1))} aria-label="Next day">
        ›
      </button>
      {day !== startOfDay(now) && (
        <button className="btn" onClick={() => onDay(startOfDay(now))}>
          Today
        </button>
      )}
      <span className="spacer" />
      {children}
    </div>
  );
}
