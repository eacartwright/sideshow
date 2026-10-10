import {
  DEFAULT_ENTRY_FORMAT,
  durationMs,
  firstLine,
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
import { dayLabel, entryDate, entryHours, entryTime, hm, whenLabel } from "../format";
import { bareText, fieldText, useA, useM, useNow, type Model, type TaskInfo } from "../model";
import { addDays, DayNav } from "./DayNav";
import { Dialog } from "./Dialog";
import { FieldInput, TicketInfo } from "./fields";
import { defaultManualSpan, SessionEditor } from "./SessionEditor";

// Time entries, ready to type into another system (ConnectWise at this job). Grouped by task
// (entries go in ticket by ticket): the task fields once, then one block per session (one
// session = one entry). What's shown, in what order and format, is the profile's entryFormat.
// Every field copies with one click.
// "To enter" is everything not yet marked entered, across days; "By day" is a day's log.

type Mode = "todo" | "day";

const CONTINUATION = "Continuation of previous work";

const TIMES = new Set(["date", "start", "end", "hours"]);

/** The entry format, with the profile's fields split into task-level and per-entry. */
function layout(m: Model) {
  const fmt: EntryFormat = m.profile.entryFormat ?? {
    ...DEFAULT_ENTRY_FORMAT,
    // Without an entryFormat, every field the profile has.
    fields: [...DEFAULT_ENTRY_FORMAT.fields, ...m.profile.fields.map((d) => d.key)],
  };
  const def = (k: string) => m.profile.fields.find((d) => d.key === k);
  const taskDefs = fmt.fields.map(def).filter((d): d is FieldDef => d?.on === "task");
  const sessionKeys = fmt.fields.filter((k) => !def(k) || def(k)!.on === "session");
  return { fmt, def, taskDefs, sessionKeys, target: fmt.target ?? "the other system" };
}

/** What a field copies as: a list item's name, a ticket # without its "#". */
function copyValue(m: Model, d: FieldDef, v: FieldValue | undefined): string {
  if (d.type === "text") return bareText(d, v);
  if (d.type === "bool") return v ? "Yes" : "";
  return fieldText(d, v, m.view);
}

export function Entries({ onClose }: { onClose: () => void }) {
  const m = useM();
  const now = useNow(30_000);
  const [mode, setMode] = useState<Mode>("todo");
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const [openIds, setOpenIds] = useState<Set<Id>>(() => new Set());

  const all = Object.values(m.view.sessions)
    .filter((s) => !s.deleted && m.tasks.has(s.taskId))
    .sort((a, b) => a.start - b.start);
  const todo = all.filter((s) => !s.enteredAt);
  const list = mode === "todo" ? todo : all.filter((s) => s.start >= day && s.start < addDays(day, 1));

  // One group per task, since entries go into CW ticket by ticket. Within a task, oldest first
  // with a still-running session last; tasks ordered by their oldest entry, running-only ones last.
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

  const toggle = (id: Id) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Dialog title="Time entries" onClose={onClose} className="entries">
      <div className="tabs tabs-2" role="tablist">
        <button role="tab" aria-selected={mode === "todo"} className={`tab ${mode === "todo" ? "on" : ""}`} onClick={() => setMode("todo")}>
          To enter
          {todo.length > 0 && <span className="count">{todo.length}</span>}
        </button>
        <button role="tab" aria-selected={mode === "day"} className={`tab ${mode === "day" ? "on" : ""}`} onClick={() => setMode("day")}>
          By day
        </button>
      </div>

      {mode === "day" && (
        <DayNav day={day} onDay={setDay} now={now}>
          {list.length > 0 && <span className="muted small">{hm(list.reduce((t, s) => t + durationMs(s, now), 0))}</span>}
        </DayNav>
      )}

      {groups.map((g) => (
        <TaskGroup
          key={g.info.task.id}
          info={g.info}
          sessions={g.sessions}
          now={now}
          // A single ticket needs no extra tap.
          open={groups.length === 1 || openIds.has(g.info.task.id)}
          onToggle={() => toggle(g.info.task.id)}
          day={mode === "day" ? day : null}
        />
      ))}
      {list.length === 0 && (
        <p className="empty">{mode === "todo" ? "All caught up. Nothing left to enter." : "No time tracked this day."}</p>
      )}
    </Dialog>
  );
}

function TaskGroup({
  info,
  sessions,
  now,
  open,
  onToggle,
  day,
}: {
  info: TaskInfo;
  sessions: Session[];
  now: number;
  open: boolean;
  onToggle: () => void;
  /** The day being shown in By day, for "+ Add time". */
  day: Ms | null;
}) {
  const m = useM();
  const a = useA();
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [merging, setMerging] = useState(false);
  const [picked, setPicked] = useState<Set<Id>>(() => new Set());
  const pickedList = sessions.filter((s) => picked.has(s.id));
  const pickedSameDay = pickedList.every((s) => startOfDay(s.start) === startOfDay(pickedList[0]!.start));
  const changed = sessions.filter((s) => s.changedSinceEntered && !s.enteredAt).length;
  const { fmt, def, taskDefs, sessionKeys, target } = layout(m);
  const total = sessions.reduce((t, s) => t + durationMs(s, now), 0);
  const entered = sessions.filter((s) => s.enteredAt).length;
  const enterable = sessions.filter((s) => !s.enteredAt && s.end !== null);
  const fields = info.task.fields;
  const missing = [
    ...taskDefs.filter((d) => !copyValue(m, d, fields[d.key])).map((d) => d.label.toLowerCase()),
    ...sessionKeys
      .map(def)
      .filter((d): d is FieldDef => !!d && sessions.some((s) => !copyValue(m, d, s.fields[d.key])))
      .map((d) => d.label.toLowerCase()),
    changed > 0 && `${target} update (${changed} changed)`,
  ].filter(Boolean);
  const meta = [
    ...taskDefs.map((d) => fieldText(d, fields[d.key], m.view)),
    entered ? `${entered} of ${sessions.length} entered` : `${sessions.length} ${sessions.length === 1 ? "entry" : "entries"}`,
    hm(total),
  ].filter(Boolean);

  return (
    <section className={`entry-task ${open ? "open" : ""} ${enterable.length === 0 && entered ? "entered" : ""}`}>
      <button className="entry-task-head" onClick={onToggle} aria-expanded={open}>
        <span className="entry-task-text">
          <span className={`row-title ${info.titleDerived ? "derived" : ""}`}>{info.title}</span>
          <span className="row-meta">{meta.join(" · ")}</span>
          {missing.length > 0 && <span className="warn small">⚠ needs {missing.join(", ")}</span>}
        </span>
        <svg className="chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      {open && (
        <div className="entry-task-body">
          {taskDefs.length > 0 && (
            <div className="entry-fields">
              {taskDefs.map((d) => {
                const value = copyValue(m, d, fields[d.key]);
                if (value) return <CopyField key={d.key} label={d.label} value={value} />;
                return (
                  <Missing key={d.key} label={d.label}>
                    {d.type === "text" ? (
                      <CommitInput placeholder={`Add ${d.label.toLowerCase()}`} onCommit={(v) => a.setTaskField(info.task.id, d.key, v)} />
                    ) : (
                      <FieldInput def={d} value={undefined} onChange={(v) => a.setTaskField(info.task.id, d.key, v)} />
                    )}
                  </Missing>
                );
              })}
            </div>
          )}
          <TicketInfo task={info.task} />

          {merging ? (
            <div className="merge-pick">
              <p className="muted small">Pick the entries to combine (same day). Earliest start to latest end, notes joined.</p>
              {sessions.map((s) => (
                <label key={s.id} className={`merge-row ${picked.has(s.id) ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={picked.has(s.id)}
                    onChange={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (!next.delete(s.id)) next.add(s.id);
                        return next;
                      })
                    }
                  />
                  <span className="merge-row-text">
                    <span>
                      {dayLabel(s.start, now)} · {entryTime(s.start, fmt.time)}–{s.end ? entryTime(s.end, fmt.time) : "now"} ·{" "}
                      {entryHours(durationMs(s, now), fmt.hours)} h
                    </span>
                    <span className="row-meta">{firstLine(s.notes) || CONTINUATION}</span>
                  </span>
                </label>
              ))}
              <div className="entry-foot">
                {pickedList.length > 1 && !pickedSameDay && <span className="warn small">Must be the same day</span>}
                <span className="spacer" />
                <button
                  className="btn"
                  onClick={() => {
                    setMerging(false);
                    setPicked(new Set());
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn primary"
                  disabled={pickedList.length < 2 || !pickedSameDay}
                  onClick={() => {
                    a.mergeSessions(pickedList.map((s) => s.id));
                    setMerging(false);
                    setPicked(new Set());
                  }}
                >
                  Merge {pickedList.length > 1 ? pickedList.length : ""}
                </button>
              </div>
            </div>
          ) : (
            <>
              {sessions.map((s) => (
                <SessionEntry
                  key={s.id}
                  session={s}
                  now={now}
                  editing={editingId === s.id}
                  onEdit={() => setEditingId(editingId === s.id ? null : s.id)}
                />
              ))}
              <div className="entry-foot">
                <button
                  className="btn subtle"
                  onClick={() => {
                    const { start, end } = defaultManualSpan(day);
                    setEditingId(a.createSession(info.task.id, start, end));
                  }}
                >
                  + Add time
                </button>
                {sessions.length > 1 && (
                  <button className="btn subtle" onClick={() => setMerging(true)}>
                    Merge…
                  </button>
                )}
                <span className="spacer" />
                {enterable.length > 1 && (
                  <button
                    className="btn"
                    onClick={() => {
                      const at = Date.now();
                      for (const s of enterable) a.updateSession(s.id, { enteredAt: at });
                    }}
                  >
                    ✓ Mark all {enterable.length} entered
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function SessionEntry({
  session: s,
  now,
  editing,
  onEdit,
}: {
  session: Session;
  now: number;
  editing: boolean;
  onEdit: () => void;
}) {
  const m = useM();
  const a = useA();
  const running = s.end === null;
  const dur = durationMs(s, now);
  const { fmt, def, sessionKeys, target } = layout(m);

  if (editing) {
    return (
      <article className="entry editing">
        <SessionEditor session={s} onDone={onEdit} />
      </article>
    );
  }

  const time = (k: string) => {
    switch (k) {
      case "date":
        return <CopyField key={k} label="Date" value={entryDate(s.start, fmt.date)} stacked />;
      case "start":
        return <CopyField key={k} label="Start" value={entryTime(s.start, fmt.time)} stacked />;
      case "end":
        return running ? (
          <Missing key={k} label="End" stacked>
            <span className="muted">running</span>
          </Missing>
        ) : (
          <CopyField key={k} label="End" value={entryTime(s.end!, fmt.time)} stacked />
        );
      case "hours":
        return <CopyField key={k} label="Hours" value={entryHours(dur, fmt.hours)} stacked />;
    }
  };
  const field = (k: string) => {
    if (k === "notes") return <CopyField key={k} label="Notes" value={s.notes.trim() || CONTINUATION} multiline />;
    const d = def(k)!;
    const value = copyValue(m, d, s.fields[k]);
    if (value) return <CopyField key={k} label={d.label} value={value} />;
    return (
      <Missing key={k} label={d.label}>
        <FieldInput def={d} value={undefined} resetKey={s.id} onChange={(v) => a.setSessionField(s.id, k, v)} />
      </Missing>
    );
  };

  return (
    <article className={`entry ${s.enteredAt ? "entered" : ""}`}>
      {s.changedSinceEntered && !s.enteredAt && (
        <div className="warn small">⚠ Changed after you entered it. Update the entry in {target}, then mark it again.</div>
      )}
      <div className="entry-times">{sessionKeys.filter((k) => TIMES.has(k)).map(time)}</div>
      <div className="entry-fields">{sessionKeys.filter((k) => !TIMES.has(k)).map(field)}</div>

      <footer className="entry-foot">
        <span className="muted small">{dayLabel(s.start, now)}</span>
        <button className="btn subtle" onClick={onEdit} aria-label="Edit this entry">
          ✎ Edit
        </button>
        <span className="spacer" />
        {s.enteredAt ? (
          <>
            <span className="entered-label">✓ Entered {whenLabel(s.enteredAt, now)}</span>
            <button className="btn subtle" onClick={() => a.updateSession(s.id, { enteredAt: null })}>
              Undo
            </button>
          </>
        ) : (
          <button
            className="btn primary"
            disabled={running}
            title={running ? "Stop it first" : `Done in ${target}`}
            onClick={() => a.updateSession(s.id, { enteredAt: Date.now() })}
          >
            ✓ Mark entered
          </button>
        )}
      </footer>
    </article>
  );
}

/** A field you copy with one click (or Enter/Space). */
function CopyField({ label, value, multiline, stacked }: { label: string; value: string; multiline?: boolean; stacked?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <button
      type="button"
      className={`copy-field ${multiline ? "multi" : ""} ${stacked ? "stacked" : ""} ${copied ? "copied" : ""}`}
      title={`Copy ${label}`}
      onClick={async () => {
        if (!(await copyText(value))) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
      }}
    >
      <span className="copy-label">{label}</span>
      <span className="copy-value">{value}</span>
      <span className="copy-hint" aria-live="polite">
        {copied ? "Copied ✓" : "Copy"}
      </span>
    </button>
  );
}

function Missing({ label, children, stacked }: { label: string; children: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={`copy-field missing ${stacked ? "stacked" : ""}`}>
      <span className="copy-label">{label}</span>
      <span className="copy-value">{children}</span>
      <span className="copy-hint warn" aria-hidden>
        ⚠
      </span>
    </div>
  );
}

/** Saves on Enter or blur, so the card doesn't swap the input out mid-typing. */
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
