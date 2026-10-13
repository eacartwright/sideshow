import { durationMs, startOfDay, type Ms, type Session } from "@sideshow/shared";
import { hm } from "../format";
import { useA, useNow } from "../model";
import { SessionFieldInputs } from "./fields";
import { RichNotes } from "./RichNotes";

// Edit one session: day, start/end (native time inputs, so the iPhone shows its wheel),
// deduct, work type, notes; snap to the quarter hour; delete. Used in Task details and
// Time entries. Every change saves as you go.

const pad = (n: number) => n.toString().padStart(2, "0");
const DAY = 86_400_000;
const QUARTER = 15 * 60_000;

const dateValue = (t: Ms) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const timeValue = (t: Ms) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Local time on the day that starts at `day`. */
export function at(day: Ms, hhmm: string): Ms | null {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}
const snap = (t: Ms) => Math.round(t / QUARTER) * QUARTER;
/** Now, to the minute (CW's entries are to the minute). */
const nowMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** Beside a time: set it to now, like the clock button in CW. (Text, not a clock icon: the browser's time input has its own clock.) */
function NowButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn subtle now-btn" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      Now
    </button>
  );
}

export function SessionEditor({ session: s, onDone }: { session: Session; onDone?: () => void }) {
  const a = useA();
  const now = useNow(30_000);
  const running = s.end === null;
  const day = startOfDay(s.start);
  const snapped = snap(s.start) === s.start && (running || snap(s.end!) === s.end);

  const setDay = (value: string) => {
    const [y, mo, d] = value.split("-").map(Number);
    if (!y || !mo || !d) return;
    // Move the whole session to that day, keeping its times.
    const shift = startOfDay(new Date(y, mo - 1, d, 12).getTime()) - day;
    if (shift) a.updateSession(s.id, running ? { start: s.start + shift } : { start: s.start + shift, end: s.end! + shift });
  };
  const setStart = (value: string) => {
    const t = at(day, value);
    if (t !== null && (running ? t <= Date.now() : t < s.end!)) a.updateSession(s.id, { start: t });
  };
  const setEnd = (value: string) => {
    let t = at(day, value);
    if (t === null) return;
    if (t <= s.start) t += DAY; // past midnight
    a.updateSession(s.id, { end: t });
  };

  return (
    <div className="session-editor">
      <div className="editor-grid">
        <label className="editor-field">
          <span className="copy-label">Date</span>
          <input type="date" className="editor-input" value={dateValue(s.start)} onChange={(e) => setDay(e.target.value)} />
        </label>
        <div className="editor-field">
          <label className="copy-label" htmlFor={`start-${s.id}`}>
            Start
          </label>
          <span className="time-with-now">
            <input id={`start-${s.id}`} type="time" className="editor-input" value={timeValue(s.start)} onChange={(e) => setStart(e.target.value)} />
            <NowButton
              label="Start now"
              disabled={!running && nowMinute() >= s.end!}
              onClick={() => a.updateSession(s.id, { start: nowMinute() })}
            />
          </span>
        </div>
        <div className="editor-field">
          <label className="copy-label" htmlFor={`end-${s.id}`}>
            End
          </label>
          {running ? (
            <span className="editor-static muted">running</span>
          ) : (
            <span className="time-with-now">
              <input id={`end-${s.id}`} type="time" className="editor-input" value={timeValue(s.end!)} onChange={(e) => setEnd(e.target.value)} />
              <NowButton
                label="End now"
                disabled={nowMinute() <= s.start}
                onClick={() => a.updateSession(s.id, { end: nowMinute() })}
              />
            </span>
          )}
        </div>
        <label className="editor-field deduct">
          <span className="copy-label">Deduct (min)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={5}
            className="editor-input"
            value={s.deductMin}
            onChange={(e) => {
              const v = Math.max(0, Math.round(Number(e.target.value) || 0));
              a.updateSession(s.id, { deductMin: v });
            }}
          />
        </label>
      </div>
      <div className="muted small">
        {hm(durationMs(s, now))} · {(durationMs(s, now) / 3_600_000).toFixed(2)} h
        {s.end !== null && s.end - s.start >= DAY && <span className="warn"> · longer than a day?</span>}
      </div>
      <SessionFieldInputs session={s} />
      <RichNotes
        className="description"
        value={s.notes}
        resetKey={s.id}
        placeholder="Notes (empty = continuation of previous work)"
        label="Notes"
        onValue={(notes) => a.updateSession(s.id, { notes })}
      />
      <div className="row-actions">
        <button
          className="btn"
          disabled={snapped}
          title="Round start and end to the nearest 15 minutes"
          onClick={() =>
            a.updateSession(s.id, running ? { start: Math.min(snap(s.start), Date.now()) } : { start: snap(s.start), end: snap(s.end!) })
          }
        >
          Snap to 15 min
        </button>
        <button className="btn subtle danger" onClick={() => a.deleteSession(s.id)}>
          Delete
        </button>
        <span className="spacer" />
        {onDone && (
          <button className="btn primary" onClick={onDone}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

/** A sensible default span for "+ Add time": the half hour before now, or midday on a past day. */
export function defaultManualSpan(day: Ms | null): { start: Ms; end: Ms } {
  const today = startOfDay(Date.now());
  if (day !== null && day !== today) {
    const start = day + 12 * 3_600_000;
    return { start, end: start + 30 * 60_000 };
  }
  const end = Math.floor(Date.now() / QUARTER) * QUARTER;
  return { start: end - 30 * 60_000, end };
}
