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
import { useEffect, useRef, useState } from "react";
import { copyText } from "../clipboard";
import { entryDate, entryHours, entryTime, hm, whenLabel } from "../format";
import { bareText, fieldText, useA, useM, useNow, type Model, type TaskInfo } from "../model";
import { DayCalendar } from "./DayCalendar";
import { addDays, DayNav } from "./DayNav";
import { FieldInput, TicketInfo, ticketUrl } from "./fields";
import { isUpdate, PushDialog, pushProblem } from "./PushDialog";
import { Switcher } from "./Switcher";
import { defaultManualSpan, SessionEditor } from "./SessionEditor";

// The Day page (DESIGN.md §7): a day's sessions as a table, ready to enter into another system
// (ConnectWise at this job). Grouped by task, because entries go in ticket by ticket: the task
// fields once in the group's header row, then one row per session (= one entry). Columns and
// formats come from the profile's entryFormat. Click a value to copy it.
// "Day" is one day's log; "To enter" is everything not yet marked entered, across days.
// Built for the desktop's width; on a phone each row wraps into a small card.

type Mode = "day" | "todo";
/**
 * TEMPORARY: two ways to lay out a task's fields, while Evan picks one. "slots": the group's
 * header row in fixed-width slots (ticket, title, client, CW summary). "columns": ticket and
 * client as table columns on the group's first row, the title on a slim line above.
 */
type Layout = "slots" | "columns";
const LAYOUT_KEY = "sideshow:entries-layout";
function savedLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "columns" ? "columns" : "slots";
  } catch {
    return "slots";
  }
}

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

/** What a field copies as: a list item's name, a ticket # without its "#". An unset field with a default copies that. */
function copyValue(m: Model, d: FieldDef, v: FieldValue | undefined): string {
  v ??= d.default;
  if (d.type === "text") return bareText(d, v);
  if (d.type === "bool") return v ? "Yes" : "";
  return fieldText(d, v, m.view);
}

export function DayPage({ onClose, onOpenTask }: { onClose: () => void; onOpenTask: (taskId: Id) => void }) {
  const m = useM();
  const now = useNow(30_000);
  const [mode, setMode] = useState<Mode>("day");
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  // The session picked in the calendar or the table; the other one highlights it too.
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  // A span dragged out on the calendar, waiting for a task to be picked.
  const [adding, setAdding] = useState<{ start: Ms; end: Ms } | null>(null);
  // Pushing to CW: the ticked rows, and the sessions in the open push preview.
  const canPush = !!m.config.cwPush;
  const [checked, setChecked] = useState<Set<Id>>(() => new Set());
  const [pushing, setPushing] = useState<Id[] | null>(null);
  const [tableLayout, setTableLayout] = useState<Layout>(savedLayout);
  const { columns, target, taskDefs } = layout(m);
  const dayEnd = addDays(day, 1);

  const all = Object.values(m.view.sessions)
    .filter((s) => !s.deleted && m.tasks.has(s.taskId))
    .sort((a, b) => a.start - b.start);
  const todo = all.filter((s) => !s.enteredAt);
  const list = mode === "todo" ? todo : all.filter((s) => s.start >= day && s.start < dayEnd);
  // The calendar also shows sessions that run into the day from the one before.
  const onCalendar = all.filter((s) => s.start < dayEnd && (s.end ?? now) > day);
  const total = list.reduce((t, s) => t + durationMs(s, now), 0);
  const shownChecked = list.filter((s) => checked.has(s.id)).map((s) => s.id);

  // Entries pushed earlier may have been deleted in CW since: check the ones on screen when the
  // page opens or the day or tab changes (and on a group's ↻).
  const a = useA();
  const shownPushed = list.filter((s) => s.ext?.cw?.entryId).map((s) => s.id);
  const checkedView = useRef("");
  useEffect(() => {
    const view = `${mode}:${day}`;
    if (!m.config.cw || checkedView.current === view) return;
    checkedView.current = view;
    if (shownPushed.length) void a.checkCw(shownPushed);
  });
  const toggleCheck = (ids: Id[], on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

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
        {canPush && shownChecked.length > 0 && (
          <div className="push-bar" role="status">
            <strong>{shownChecked.length} selected</strong>
            <button className="btn primary sm" onClick={() => setPushing(shownChecked)}>
              Push {shownChecked.length} to {target}…
            </button>
            <button className="btn subtle sm" onClick={() => setChecked(new Set())}>
              Clear
            </button>
          </div>
        )}
        <span className="segmented layout-pick" role="group" aria-label="Layout (testing)" title="Testing two layouts: pick one and this switch goes away">
          {(["slots", "columns"] as Layout[]).map((l) => (
            <button
              key={l}
              type="button"
              className={`seg ${tableLayout === l ? "seg-on" : ""}`}
              aria-pressed={tableLayout === l}
              onClick={() => {
                setTableLayout(l);
                try {
                  localStorage.setItem(LAYOUT_KEY, l);
                } catch {
                  // per-device convenience only
                }
              }}
            >
              {l === "slots" ? "Slots" : "Columns"}
            </button>
          ))}
        </span>
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

      <div className={mode === "day" ? "day-split" : ""}>
        {mode === "day" && (
          <DayCalendar
            day={day}
            dayEnd={dayEnd}
            sessions={onCalendar}
            now={now}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenTask={onOpenTask}
            adding={adding}
            onAdd={setAdding}
          />
        )}
        {groups.length > 0 ? (
          <div className="table-wrap">
            <table className={`entries-table ${mode === "day" ? "one-day" : ""} layout-${tableLayout}`}>
              <thead>
                <tr>
                  {canPush && (
                    <th className="col-pick">
                      <input
                        type="checkbox"
                        aria-label="Select every entry that can be pushed"
                        title="Select every entry that can be pushed"
                        checked={list.some((s) => !s.enteredAt && !pushProblem(m, s)) && list.filter((s) => !s.enteredAt && !pushProblem(m, s)).every((s) => checked.has(s.id))}
                        onChange={(e) => toggleCheck(list.filter((s) => !s.enteredAt && !pushProblem(m, s)).map((s) => s.id), e.target.checked)}
                      />
                    </th>
                  )}
                  {tableLayout === "columns" &&
                    taskDefs.map((d) => (
                      <th key={d.key} className={`col-task col-${d.key}`}>
                        {d.label}
                      </th>
                    ))}
                  {columns.map((k) => (
                    <th key={k} className={`col-${k}`}>
                      {TIME_LABELS[k] ?? (k === "notes" ? "Notes" : m.profile.fields.find((d) => d.key === k)?.label)}
                    </th>
                  ))}
                  {canPush && <th className="col-email">Email</th>}
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
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  checked={checked}
                  onCheck={toggleCheck}
                  onPush={setPushing}
                  tableLayout={tableLayout}
                />
              ))}
            </table>
          </div>
        ) : (
          <p className="empty">
            {mode === "todo" ? `Nothing left to enter in ${target}.` : "No time tracked that day. Drag across the calendar to add some."}
          </p>
        )}
      </div>
      {adding && <Switcher span={adding} onAdded={setSelectedId} onClose={() => setAdding(null)} />}
      {pushing && (
        <PushDialog sessionIds={pushing} onClose={() => setPushing(null)} onDone={(ids) => toggleCheck(ids, false)} />
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
  selectedId,
  onSelect,
  checked,
  onCheck,
  onPush,
  tableLayout,
}: {
  info: TaskInfo;
  sessions: Session[];
  now: number;
  /** The day being shown, for "+ Add time"; null in To enter. */
  day: Ms | null;
  onOpenTask: (taskId: Id) => void;
  selectedId: Id | null;
  onSelect: (sessionId: Id) => void;
  checked: Set<Id>;
  onCheck: (ids: Id[], on: boolean) => void;
  /** Open the push preview for these sessions. */
  onPush: (ids: Id[]) => void;
  tableLayout: Layout;
}) {
  const m = useM();
  const a = useA();
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [merging, setMerging] = useState(false);
  const [picked, setPicked] = useState<Set<Id>>(() => new Set());
  const { def, taskDefs, columns, target } = layout(m);
  const canPush = !!m.config.cwPush;
  const asColumns = tableLayout === "columns";
  const span = columns.length + 1 + (canPush ? 2 : 0) + (asColumns ? taskDefs.length : 0);
  // The ticket field leads (far left), the other task fields (client) come after the title.
  const ticketDef = taskDefs.find((d) => d.key === m.profile.connectwise?.ticketField);
  const otherDefs = taskDefs.filter((d) => d !== ticketDef);
  const orderedDefs = ticketDef ? [ticketDef, ...otherDefs] : otherDefs;
  const pushable = sessions.filter((s) => !s.enteredAt && !pushProblem(m, s));
  const link = ticketUrl(m, info.task);
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
  /** A task field in the header or its column: click-to-copy when set (the ticket with ↗), else an input. */
  const taskField = (d: FieldDef) => {
    const value = copyValue(m, d, fields[d.key]);
    if (value) {
      // Plain text: its slot or column says what it is.
      const chip = <Copy label={d.label} value={value} shown={fieldText(d, fields[d.key], m.view)} />;
      if (d.key !== m.profile.connectwise?.ticketField || !link) return chip;
      return (
        <span className="ticket-chip">
          {chip}
          <a className="btn subtle sm icon ticket-open" href={link} target="_blank" rel="noreferrer" title="Open the ticket in ConnectWise" aria-label="Open the ticket in ConnectWise">
            ↗
          </a>
        </span>
      );
    }
    return (
      <span className="group-missing">
        {d.type === "text" ? (
          <CommitInput placeholder={`Add ${d.label.toLowerCase()}`} onCommit={(v) => a.setTaskField(info.task.id, d.key, v)} />
        ) : (
          <FieldInput def={d} value={undefined} onChange={(v) => a.setTaskField(info.task.id, d.key, v)} />
        )}
      </span>
    );
  };
  const stopMerging = () => {
    setMerging(false);
    setPicked(new Set());
  };

  return (
    <tbody className={`entry-group ${enterable.length === 0 && entered ? "all-entered" : ""}`}>
      <tr className="group-head">
        <td colSpan={span}>
          <div
            className={`group-head-inner ${asColumns ? "slim" : "slots"}`}
            style={asColumns ? undefined : { gridTemplateColumns: `${ticketDef ? "8.5rem " : ""}minmax(8rem, 17rem) ${otherDefs.map(() => "13rem").join(" ")} minmax(0, 1fr) auto` }}
          >
            {!asColumns && ticketDef && <span className="slot">{taskField(ticketDef)}</span>}
            <button className="group-title" onClick={() => onOpenTask(info.task.id)} title={`${info.title}\nOpen task details`}>
              <span className={`row-title ${info.titleDerived ? "derived" : ""}`}>{info.title}</span>
            </button>
            {!asColumns &&
              otherDefs.map((d) => (
                <span key={d.key} className="slot">
                  {taskField(d)}
                </span>
              ))}
            <span className="slot slot-info">
              <TicketInfo
                task={info.task}
                compact
                onRefresh={() => {
                  const ids = sessions.filter((s) => s.ext?.cw?.entryId).map((s) => s.id);
                  if (ids.length) void a.checkCw(ids);
                }}
              />
            </span>
            <span className="group-end">
            {missingSession.length > 0 && <span className="warn small">⚠ needs {missingSession.join(", ")}</span>}
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
                {canPush
                  ? pushable.length > 0 && (
                      <button className="btn primary sm" onClick={() => onPush(pushable.map((s) => s.id))}>
                        {pushable.length > 1 ? `Push all ${pushable.length}…` : "Push…"}
                      </button>
                    )
                  : enterable.length > 1 && (
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
            </span>
          </div>
        </td>
      </tr>

      {sessions.map((s, i) => (
        <SessionRows
          key={s.id}
          lead={
            asColumns
              ? orderedDefs.map((d) => (
                  <td key={d.key} className={`col-task col-${d.key}`} data-label={d.label}>
                    {i === 0 ? taskField(d) : null}
                  </td>
                ))
              : null
          }
          session={s}
          now={now}
          span={span}
          editing={!merging && editingId === s.id}
          onEdit={() => setEditingId(editingId === s.id ? null : s.id)}
          picking={merging}
          checked={checked.has(s.id)}
          onCheck={(on) => onCheck([s.id], on)}
          onPush={() => onPush([s.id])}
          selected={selectedId === s.id}
          onSelect={() => onSelect(s.id)}
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
  checked,
  onCheck,
  onPush,
  lead,
  selected,
  onSelect,
  picked,
  onPick,
}: {
  session: Session;
  now: number;
  span: number;
  editing: boolean;
  onEdit: () => void;
  picking: boolean;
  /** Cells before the session's own: the task's fields, in the "columns" layout. */
  lead: React.ReactNode;
  /** Ticked for a push to CW. */
  checked: boolean;
  onCheck: (on: boolean) => void;
  onPush: () => void;
  /** Picked in the calendar (or by clicking this row). */
  selected: boolean;
  onSelect: () => void;
  picked: boolean;
  onPick: () => void;
}) {
  const m = useM();
  const a = useA();
  const running = s.end === null;
  const { fmt, def, columns, target } = layout(m);
  const canPush = !!m.config.cwPush;
  const problem = canPush ? pushProblem(m, s) : null;
  const inCw = !!s.ext?.cw?.entryId;
  const email = s.ext?.cw?.email === true;
  const rowRef = useRef<HTMLTableRowElement>(null);
  // Picked in the calendar: bring the row into view.
  useEffect(() => {
    // Up or down only: a table wider than its box shouldn't slide sideways.
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest", inline: "start", behavior: "smooth" });
  }, [selected]);

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
      <tr
        ref={rowRef}
        className={`session-row ${s.enteredAt ? "entered" : ""} ${editing ? "editing" : ""} ${picked ? "picked" : ""} ${selected ? "selected" : ""}`}
        onClick={onSelect}
      >
        {canPush && (
          <td className="col-pick">
            {!s.enteredAt && (
              <input
                type="checkbox"
                checked={checked}
                disabled={!!problem}
                title={problem ? `Can't push yet: ${problem}` : "Select for pushing"}
                aria-label="Select for pushing"
                onChange={(e) => onCheck(e.target.checked)}
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </td>
        )}
        {lead}
        {columns.map(cell)}
        {canPush && (
          <td className="col-email" data-label="Email">
            <button
              type="button"
              className={`email-toggle ${email ? "on" : ""}`}
              aria-pressed={email}
              disabled={inCw}
              title={
                inCw
                  ? "Already pushed: CW's emails go out only when an entry is first added"
                  : email
                    ? "CW will email the ticket's contact, CCs and resources when this is pushed"
                    : "No emails (click to have CW email the contact, CCs and resources)"
              }
              onClick={() => a.updateSession(s.id, { ext: { cw: { email: email ? null : true } } })}
            >
              ✉ {email ? "On" : "Off"}
            </button>
          </td>
        )}
        <td className="col-actions">
          <div className="row-tools">
            {picking ? (
              <label className="pick">
                <input type="checkbox" checked={picked} onChange={onPick} aria-label="Merge this entry" />
              </label>
            ) : (
              <>
                {s.ext?.cw?.removedAt && !s.enteredAt && (
                  <span className="warn small nowrap" title={`Its entry was deleted in ${target}. Push it again to add it back.`}>
                    ⚠ Deleted in CW
                  </span>
                )}
                {s.changedSinceEntered && !s.enteredAt && !s.ext?.cw?.removedAt && (
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
                    title={
                      inCw
                        ? `In ${target} as entry #${String(s.ext!.cw!.entryId)}, ${whenLabel(s.enteredAt, now)}. Click to put it back on To enter.`
                        : `Entered ${whenLabel(s.enteredAt, now)}. Click to undo.`
                    }
                  >
                    ✓ {inCw ? `In ${target === "ConnectWise" ? "CW" : target}` : "Entered"}
                  </button>
                ) : canPush ? (
                  <>
                    <button
                      className="btn subtle sm icon"
                      disabled={running}
                      title={running ? "Stop it first" : `Mark entered without pushing (you entered it in ${target} yourself)`}
                      aria-label="Mark entered without pushing"
                      onClick={() => a.updateSession(s.id, { enteredAt: Date.now() })}
                    >
                      ✓
                    </button>
                    <button
                      className="btn primary sm"
                      disabled={!!problem}
                      title={problem ? `Can't push yet: ${problem}` : isUpdate(s) ? `Update entry #${String(s.ext!.cw!.entryId)} in ${target}` : `Add this to the ticket in ${target}`}
                      onClick={onPush}
                    >
                      {isUpdate(s) ? "Update…" : "Push…"}
                    </button>
                  </>
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
