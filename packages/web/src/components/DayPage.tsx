import {
  DEFAULT_ENTRY_FORMAT,
  durationMs,
  startOfDay,
  type EntryFormat,
  type FieldDef,
  type FieldValue,
  type Id,
  type Ms,
  type Session,
} from "@sideshow/shared";
import { useRef, useState } from "react";
import { copyText } from "../clipboard";
import { entryDate, entryHours, entryTime, hm, whenLabel } from "../format";
import { bareText, fieldText, useA, useM, useNow, type Model, type TaskInfo } from "../model";
import { addDays, DayNav } from "./DayNav";
import { FieldInput, TicketInfo } from "./fields";
import { defaultManualSpan, SessionEditor } from "./SessionEditor";

// The Day page (DESIGN.md §7): a day's sessions as a table, ready to enter into another system
// (ConnectWise at this job). Grouped by task, because entries go in ticket by ticket: the task
// fields once in the group's header row, then one row per session (= one entry). Columns and
// formats come from the profile's entryFormat. Click a value to copy it.
// "Day" is one day's log; "To enter" is everything not yet marked entered, across days.
// Built for the desktop's width; on a phone each row wraps into a small card.

type Mode = "day" | "todo";

const CONTINUATION = "Continuation of previous work";
const TIMES = new Set(["date", "start", "end", "hours"]);
const TIME_LABELS: Record<string, string> = { date: "Date", start: "Start", end: "End", hours: "Hours" };

/** The entry format, with the profile's fields split into task-level and per-entry. */
function layout(m: Model) {
  const fmt: EntryFormat = m.profile.entryFormat ?? {
    ...DEFAULT_ENTRY_FORMAT,
    // Without an entryFormat, every field the profile has.
    fields: [...DEFAULT_ENTRY_FORMAT.fields, ...m.profile.fields.map((d) => d.key)],
  };
  const def = (k: string) => m.profile.fields.find((d) => d.key === k);
  const taskDefs = fmt.fields.map(def).filter((d): d is FieldDef => d?.on === "task");
  const columns = fmt.fields.filter((k) => !def(k) || def(k)!.on === "session");
  return { fmt, def, taskDefs, columns, target: fmt.target ?? "the other system" };
}

/** What a field copies as: a list item's name, a ticket # without its "#". */
function copyValue(m: Model, d: FieldDef, v: FieldValue | undefined): string {
  if (d.type === "text") return bareText(d, v);
  if (d.type === "bool") return v ? "Yes" : "";
  return fieldText(d, v, m.view);
}

export function DayPage({ onClose, onOpenTask }: { onClose: () => void; onOpenTask: (taskId: Id) => void }) {
  const m = useM();
  const now = useNow(30_000);
  const [mode, setMode] = useState<Mode>("day");
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const { columns, target } = layout(m);

  const all = Object.values(m.view.sessions)
    .filter((s) => !s.deleted && m.tasks.has(s.taskId))
    .sort((a, b) => a.start - b.start);
  const todo = all.filter((s) => !s.enteredAt);
  const list = mode === "todo" ? todo : all.filter((s) => s.start >= day && s.start < addDays(day, 1));
  const total = list.reduce((t, s) => t + durationMs(s, now), 0);

  // Within a task, oldest first with a still-running session last; tasks ordered by their
  // oldest entry, running-only ones last.
  const byTask = new Map<Id, Session[]>();
  for (const s of list) byTask.set(s.taskId, [...(byTask.get(s.taskId) ?? []), s]);
  const groups = [...byTask.entries()]
    .map(([taskId, sessions]) => ({
      info: m.tasks.get(taskId)!,
      sessions: [...sessions.filter((s) => s.end !== null), ...sessions.filter((s) => s.end === null)],
    }))
    .sort((a, b) => {
      const key = (g: typeof a) => (g.sessions[0]!.end === null ? Infinity : g.sessions[0]!.start);
      return key(a) - key(b);
    });

  return (
    <section className="day-page" aria-label="Time entries">
      <div className="day-head">
        <button className="btn" onClick={onClose} title="Back to Now (Esc)">
          ← Now
        </button>
        <h2>Time entries</h2>
        <div className="tabs tabs-2" role="tablist">
          <button role="tab" aria-selected={mode === "day"} className={`tab ${mode === "day" ? "on" : ""}`} onClick={() => setMode("day")}>
            Day
          </button>
          <button role="tab" aria-selected={mode === "todo"} className={`tab ${mode === "todo" ? "on" : ""}`} onClick={() => setMode("todo")}>
            To enter
            {todo.length > 0 && <span className="count">{todo.length}</span>}
          </button>
        </div>
        {mode === "day" ? (
          <DayNav day={day} onDay={setDay} now={now}>
            {list.length > 0 && <span className="day-total">Total {hm(total)}</span>}
          </DayNav>
        ) : (
          <div className="day-nav">
            <span className="muted small">Everything not yet entered in {target}, oldest first.</span>
            <span className="spacer" />
            {list.length > 0 && <span className="day-total">Total {hm(total)}</span>}
          </div>
        )}
      </div>

      {groups.length > 0 ? (
        <table className="entries-table">
          <thead>
            <tr>
              {columns.map((k) => (
                <th key={k} className={`col-${k}`}>
                  {TIME_LABELS[k] ?? (k === "notes" ? "Notes" : m.profile.fields.find((d) => d.key === k)?.label)}
                </th>
              ))}
              <th className="col-actions">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          {groups.map((g) => (
            <EntryGroup
              key={g.info.task.id}
              info={g.info}
              sessions={g.sessions}
              now={now}
              day={mode === "day" ? day : null}
              onOpenTask={onOpenTask}
            />
          ))}
        </table>
      ) : (
        <p className="empty">{mode === "todo" ? `Nothing left to enter in ${target}.` : "No time tracked that day."}</p>
      )}
    </section>
  );
}

function EntryGroup({
  info,
  sessions,
  now,
  day,
  onOpenTask,
}: {
  info: TaskInfo;
  sessions: Session[];
  now: number;
  /** The day being shown, for "+ Add time"; null in To enter. */
  day: Ms | null;
  onOpenTask: (taskId: Id) => void;
}) {
  const m = useM();
  const a = useA();
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [merging, setMerging] = useState(false);
  const [picked, setPicked] = useState<Set<Id>>(() => new Set());
  const { def, taskDefs, columns, target } = layout(m);
  const span = columns.length + 1;
  const fields = info.task.fields;
  const total = sessions.reduce((t, s) => t + durationMs(s, now), 0);
  const entered = sessions.filter((s) => s.enteredAt).length;
  const enterable = sessions.filter((s) => !s.enteredAt && s.end !== null);
  const pickedList = sessions.filter((s) => picked.has(s.id));
  const pickedSameDay = pickedList.every((s) => startOfDay(s.start) === startOfDay(pickedList[0]!.start));
  const missingSession = columns
    .map(def)
    .filter((d): d is FieldDef => !!d && sessions.some((s) => !copyValue(m, d, s.fields[d.key])))
    .map((d) => d.label.toLowerCase());
  const stopMerging = () => {
    setMerging(false);
    setPicked(new Set());
  };

  return (
    <tbody className={`entry-group ${enterable.length === 0 && entered ? "all-entered" : ""}`}>
      <tr className="group-head">
        <td colSpan={span}>
          <div className="group-head-inner">
            <button className="group-title" onClick={() => onOpenTask(info.task.id)} title="Open task details">
              <span className={`row-title ${info.titleDerived ? "derived" : ""}`}>{info.title}</span>
            </button>
            {taskDefs.map((d) => {
              const value = copyValue(m, d, fields[d.key]);
              if (value) return <Copy key={d.key} label={d.label} value={value} shown={fieldText(d, fields[d.key], m.view)} chip />;
              return (
                <span key={d.key} className="group-missing">
                  {d.type === "text" ? (
                    <CommitInput placeholder={`Add ${d.label.toLowerCase()}`} onCommit={(v) => a.setTaskField(info.task.id, d.key, v)} />
                  ) : (
                    <FieldInput def={d} value={undefined} onChange={(v) => a.setTaskField(info.task.id, d.key, v)} />
                  )}
                </span>
              );
            })}
            <TicketInfo task={info.task} />
            {missingSession.length > 0 && <span className="warn small">⚠ needs {missingSession.join(", ")}</span>}
            <span className="spacer" />
            <span className="muted small">
              {entered ? `${entered} of ${sessions.length} entered · ` : ""}
              <strong className="group-total">{hm(total)}</strong>
            </span>
            {!merging && (
              <>
                <button
                  className="btn subtle sm"
                  onClick={() => {
                    const { start, end } = defaultManualSpan(day);
                    setEditingId(a.createSession(info.task.id, start, end));
                  }}
                >
                  + Add time
                </button>
                {sessions.length > 1 && (
                  <button
                    className="btn subtle sm"
                    onClick={() => {
                      setEditingId(null);
                      setMerging(true);
                    }}
                  >
                    Merge…
                  </button>
                )}
                {enterable.length > 1 && (
                  <button
                    className="btn sm"
                    onClick={() => {
                      const at = Date.now();
                      for (const s of enterable) a.updateSession(s.id, { enteredAt: at });
                    }}
                  >
                    ✓ Mark all {enterable.length} entered
                  </button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>

      {sessions.map((s) => (
        <SessionRows
          key={s.id}
          session={s}
          now={now}
          span={span}
          editing={!merging && editingId === s.id}
          onEdit={() => setEditingId(editingId === s.id ? null : s.id)}
          picking={merging}
          picked={picked.has(s.id)}
          onPick={() =>
            setPicked((prev) => {
              const next = new Set(prev);
              if (!next.delete(s.id)) next.add(s.id);
              return next;
            })
          }
        />
      ))}

      {merging && (
        <tr className="group-foot">
          <td colSpan={span}>
            <div className="group-head-inner">
              <span className="muted small">Tick the entries to combine (same day): earliest start to latest end, notes joined.</span>
              {pickedList.length > 1 && !pickedSameDay && <span className="warn small">Must be the same day</span>}
              <span className="spacer" />
              <button className="btn sm" onClick={stopMerging}>
                Cancel
              </button>
              <button
                className="btn primary sm"
                disabled={pickedList.length < 2 || !pickedSameDay}
                onClick={() => {
                  a.mergeSessions(pickedList.map((s) => s.id));
                  stopMerging();
                }}
              >
                Merge {pickedList.length > 1 ? pickedList.length : ""}
              </button>
            </div>
          </td>
        </tr>
      )}
      {sessions.some((s) => s.changedSinceEntered && !s.enteredAt) && (
        <tr className="group-foot">
          <td colSpan={span} className="warn small">
            ⚠ Changed after you entered it: update the entry in {target}, then mark it again.
          </td>
        </tr>
      )}
    </tbody>
  );
}

/** One session's row, plus the editor under it when it's open. */
function SessionRows({
  session: s,
  now,
  span,
  editing,
  onEdit,
  picking,
  picked,
  onPick,
}: {
  session: Session;
  now: number;
  span: number;
  editing: boolean;
  onEdit: () => void;
  picking: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const m = useM();
  const a = useA();
  const running = s.end === null;
  const { fmt, def, columns, target } = layout(m);

  const cell = (k: string) => {
    if (TIMES.has(k)) {
      const label = TIME_LABELS[k]!;
      let value: string | null;
      if (k === "date") value = entryDate(s.start, fmt.date);
      else if (k === "start") value = entryTime(s.start, fmt.time);
      else if (k === "end") value = running ? null : entryTime(s.end!, fmt.time);
      else value = entryHours(durationMs(s, now), fmt.hours);
      return (
        <td key={k} className={`col-${k}`} data-label={label}>
          {value === null ? <span className="muted">running</span> : <Copy label={label} value={value} />}
        </td>
      );
    }
    if (k === "notes") {
      const notes = s.notes.trim();
      return (
        <td key={k} className="col-notes" data-label="Notes">
          <Copy label="Notes" value={notes || CONTINUATION} shown={notes ? undefined : CONTINUATION} multiline muted={!notes} />
        </td>
      );
    }
    const d = def(k)!;
    const set = !!copyValue(m, d, s.fields[k]);
    return (
      <td key={k} className={`col-${k} col-field ${set ? "" : "missing"}`} data-label={d.label}>
        <FieldInput def={d} value={s.fields[k]} resetKey={s.id} onChange={(v) => a.setSessionField(s.id, k, v)} />
      </td>
    );
  };

  return (
    <>
      <tr className={`session-row ${s.enteredAt ? "entered" : ""} ${editing ? "editing" : ""} ${picked ? "picked" : ""}`}>
        {columns.map(cell)}
        <td className="col-actions">
          <div className="row-tools">
            {picking ? (
              <label className="pick">
                <input type="checkbox" checked={picked} onChange={onPick} aria-label="Merge this entry" />
              </label>
            ) : (
              <>
                {s.changedSinceEntered && !s.enteredAt && (
                  <span className="warn" title={`Changed after you entered it; update it in ${target}`}>
                    ⚠
                  </span>
                )}
                <button className="btn subtle sm icon" onClick={onEdit} aria-label="Edit this entry" aria-expanded={editing} title="Edit">
                  ✎
                </button>
                {s.enteredAt ? (
                  <button
                    className="entered-btn"
                    onClick={() => a.updateSession(s.id, { enteredAt: null })}
                    title={`Entered ${whenLabel(s.enteredAt, now)}. Click to undo.`}
                  >
                    ✓ Entered
                  </button>
                ) : (
                  <button
                    className="btn primary sm"
                    disabled={running}
                    title={running ? "Stop it first" : `Done in ${target}`}
                    onClick={() => a.updateSession(s.id, { enteredAt: Date.now() })}
                  >
                    Mark entered
                  </button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="editor-row">
          <td colSpan={span}>
            <SessionEditor session={s} onDone={onEdit} />
          </td>
        </tr>
      )}
    </>
  );
}

/** A value you copy with one click. `shown` is what's displayed, if different from what's copied. */
function Copy({
  label,
  value,
  shown,
  multiline,
  muted,
  chip,
}: {
  label: string;
  value: string;
  shown?: string;
  multiline?: boolean;
  muted?: boolean;
  chip?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <button
      type="button"
      className={`copy ${multiline ? "multi" : ""} ${muted ? "muted" : ""} ${chip ? "copy-chip" : ""} ${copied ? "copied" : ""}`}
      title={`Copy ${label}${multiline ? `\n\n${value}` : ""}`}
      onClick={async () => {
        if (!(await copyText(value))) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
      }}
    >
      {chip && <span className="copy-chip-label">{label}</span>}
      <span className="copy-text">{multiline ? firstLines(shown ?? value) : (shown ?? value)}</span>
      <span className="copy-ok" aria-live="polite">
        {copied ? "Copied ✓" : ""}
      </span>
    </button>
  );
}

/** Notes as shown in a row: the text as written, clamped to a few lines by CSS. */
const firstLines = (notes: string) => notes.replace(/\n{3,}/g, "\n\n");

/** Saves on Enter or blur, so the row doesn't swap the input out mid-typing. */
function CommitInput({ placeholder, onCommit }: { placeholder: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState("");
  const commit = () => v.trim() && onCommit(v.trim().replace(/^#/, ""));
  return (
    <input
      className="ref-input"
      value={v}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}
