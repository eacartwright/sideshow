import { durationMs, startOfDay, type Ms, type Session, type SessionPatch } from "@sideshow/shared";
import { useState } from "react";
import { hm } from "../format";
import { useA, useNow } from "../model";
import { SessionFieldInputs } from "./fields";
import { RichNotes } from "./RichNotes";
import { Switcher } from "./Switcher";

// Edit one session: day, start/end (native time inputs, so the iPhone shows its wheel),
// deduct, work type, notes; snap to the quarter hour; move to another task; delete.
// Used in Task details, Time entries and the running card. Every change saves as you go.

const pad = (n: number) => n.toString().padStart(2, "0");
const DAY = 86_400_000;
const QUARTER = 15 * 60_000;

export const dateValue = (t: Ms) => {
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

// What a typed date or time changes on a session, or null if it doesn't make sense.
// Shared with the Day page's table, where the times are edited in place.

/** A date ("2026-10-19"): the whole session moves to that day, keeping its times. */
export function dayPatch(s: Session, value: string): SessionPatch | null {
  const [y, mo, d] = value.split("-").map(Number);
  if (!y || !mo || !d) return null;
  const shift = startOfDay(new Date(y, mo - 1, d, 12).getTime()) - startOfDay(s.start);
  if (!shift) return null;
  return s.end === null ? { start: s.start + shift } : { start: s.start + shift, end: s.end + shift };
}

/** A start time ("09:15") on the session's day: before its end (or now, while it runs). */
export function startPatch(s: Session, value: string): SessionPatch | null {
  const t = at(startOfDay(s.start), value);
  if (t === null || t === s.start || !(s.end === null ? t <= Date.now() : t < s.end)) return null;
  return { start: t };
}

/** An end time ("17:30"); one at or before the start means past midnight. */
export function endPatch(s: Session, value: string): SessionPatch | null {
  if (s.end === null) return null;
  let t = at(startOfDay(s.start), value);
  if (t === null) return null;
  if (t <= s.start) t += DAY;
  return t === s.end ? null : { end: t };
}

export function SessionEditor({ session: s, onDone }: { session: Session; onDone?: () => void }) {
  const a = useA();
  const now = useNow(30_000);
  const [moving, setMoving] = useState(false);
  const running = s.end === null;
  const snapped = snap(s.start) === s.start && (running || snap(s.end!) === s.end);

  const apply = (patch: SessionPatch | null) => patch && a.updateSession(s.id, patch);
  const setDay = (value: string) => apply(dayPatch(s, value));
  const setStart = (value: string) => apply(startPatch(s, value));
  const setEnd = (value: string) => apply(endPatch(s, value));

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
      <div className="session-fields">
        <SessionFieldInputs session={s} />
      </div>
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
        <button
          className="btn subtle"
          onClick={() => setMoving(true)}
          title="Move this entry, notes and all, to another task (another ticket) or a new one"
        >
          Move to…
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
      {moving && <Switcher move={s} onClose={() => setMoving(false)} />}
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
