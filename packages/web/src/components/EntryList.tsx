import { durationMs, firstLine, plainNote, startOfDay, type FieldDef, type Id, type Ms, type Session } from "@sideshow/shared";
import { useEffect, useRef, useState } from "react";
import { entryHours, hm, timeOfDay, whenLabel } from "../format";
import { fieldText, useA, useM, type TaskInfo } from "../model";
import { NewTicketButton } from "./CreateTicket";
import { CONTINUATION, copyValue, layout } from "./entryLayout";
import { FieldInput, FindTicketButton, ticketUrl } from "./fields";
import { isUpdate, pushProblem } from "./PushDialog";
import { defaultManualSpan, SessionEditor } from "./SessionEditor";

// The Day page as a list, for anything narrower than the full table: the phone, and a desktop
// window sharing the screen. A row says when, how long and what, plus the one thing to do next
// (Push…); everything else is a tap away in the entry's editor. Wider windows keep the work type
// and billing on the row, since those are what's usually left to fill in.

export function EntryList({
  groups,
  now,
  day,
  showDate,
  collapsed,
  onToggle,
  onOpenTask,
  onPush,
  selectedId,
  onSelect,
  openId,
  onMovedDay,
}: {
  groups: { info: TaskInfo; sessions: Session[] }[];
  now: number;
  day: Ms | null;
  /** To enter spans days, so each row says which. */
  showDate: boolean;
  collapsed: Set<Id>;
  onToggle: (taskId: Id) => void;
  onOpenTask: (taskId: Id) => void;
  onPush: (ids: Id[]) => void;
  selectedId: Id | null;
  onSelect: (sessionId: Id) => void;
  /** Open this entry's editor (one just added). */
  openId: Id | null;
  onMovedDay: (sessionId: Id, day: Ms) => void;
}) {
  return (
    <div className="elist">
      {groups.map((g) => (
        <Group
          key={g.info.task.id}
          info={g.info}
          sessions={g.sessions}
          now={now}
          day={day}
          showDate={showDate}
          collapsed={collapsed.has(g.info.task.id)}
          onToggle={() => onToggle(g.info.task.id)}
          onOpenTask={onOpenTask}
          onPush={onPush}
          selectedId={selectedId}
          onSelect={onSelect}
          openId={openId}
          onMovedDay={onMovedDay}
        />
      ))}
    </div>
  );
}

function Group({
  info,
  sessions,
  now,
  day,
  showDate,
  collapsed,
  onToggle,
  onOpenTask,
  onPush,
  selectedId,
  onSelect,
  openId,
  onMovedDay,
}: {
  info: TaskInfo;
  sessions: Session[];
  now: number;
  day: Ms | null;
  showDate: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onOpenTask: (taskId: Id) => void;
  onPush: (ids: Id[]) => void;
  selectedId: Id | null;
  onSelect: (sessionId: Id) => void;
  openId: Id | null;
  onMovedDay: (sessionId: Id, day: Ms) => void;
}) {
  const m = useM();
  const a = useA();
  const [editingId, setEditingId] = useState<Id | null>(null);
  const [merging, setMerging] = useState(false);
  const [picked, setPicked] = useState<Set<Id>>(() => new Set());
  const { taskDefs } = layout(m);
  const canPush = !!m.config.cwPush;
  const ticketKey = m.profile.connectwise?.ticketField;
  const ticket = ticketKey ? String(info.task.fields[ticketKey] ?? "") : "";
  const link = ticketUrl(m, info.task);
  const others = taskDefs.filter((d) => d.key !== ticketKey);
  const total = sessions.reduce((t, s) => t + durationMs(s, now), 0);
  const pushable = sessions.filter((s) => !s.enteredAt && !pushProblem(m, s));
  const enterable = sessions.filter((s) => !s.enteredAt && s.end !== null);
  const entered = sessions.filter((s) => s.enteredAt).length;
  const pickedList = sessions.filter((s) => picked.has(s.id));
  const sameDay = pickedList.every((s) => startOfDay(s.start) === startOfDay(pickedList[0]!.start));

  useEffect(() => {
    if (openId && sessions.some((s) => s.id === openId)) setEditingId(openId);
  }, [openId]);
  const stopMerging = () => {
    setMerging(false);
    setPicked(new Set());
  };

  return (
    <section className={`elist-group ${collapsed ? "collapsed" : ""} ${enterable.length === 0 && entered ? "all-entered" : ""}`}>
      <header className="elist-head">
        <button
          className="group-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Show ${info.title}'s entries` : `Hide ${info.title}'s entries`}
          onClick={onToggle}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="elist-head-main">
          <button className="elist-title" onClick={() => onOpenTask(info.task.id)} title={`${info.title}\nOpen task details`}>
            {info.title}
          </button>
          <div className="elist-sub">
            {ticketKey &&
              (ticket ? (
                <span className="elist-ticket">
                  #{ticket}
                  {link && (
                    <a href={link} target="_blank" rel="noreferrer" title="Open the ticket in ConnectWise" aria-label="Open the ticket in ConnectWise">
                      ↗
                    </a>
                  )}
                </span>
              ) : (
                <>
                  <FindTicketButton task={info.task} label="Find ticket" />
                  {m.profile.connectwise && <NewTicketButton taskId={info.task.id} className="btn subtle sm" />}
                </>
              ))}
            {others.map((d) => {
              const set = copyValue(m, d, info.task.fields[d.key]);
              return set ? (
                <span key={d.key} className="muted elist-field">
                  {fieldText(d, info.task.fields[d.key], m.view)}
                </span>
              ) : (
                <FieldInput key={d.key} def={d} value={undefined} resetKey={info.task.id} onChange={(v) => a.setTaskField(info.task.id, d.key, v)} />
              );
            })}
          </div>
        </div>
        <div className="elist-head-end">
          <strong className="group-total">{hm(total)}</strong>
          {entered > 0 && (
            <span className="muted small">
              {entered}/{sessions.length} entered
            </span>
          )}
        </div>
      </header>

      {!collapsed && (
        <ul className="elist-rows">
          {sessions.map((s) => (
            <Row
              key={s.id}
              session={s}
              now={now}
              showDate={showDate}
              editing={!merging && editingId === s.id}
              onEdit={() => setEditingId(editingId === s.id ? null : s.id)}
              onPush={() => onPush([s.id])}
              selected={selectedId === s.id}
              onSelect={() => onSelect(s.id)}
              merging={merging}
              picked={picked.has(s.id)}
              onPick={() =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(s.id)) next.add(s.id);
                  return next;
                })
              }
              onMovedDay={onMovedDay}
            />
          ))}
        </ul>
      )}

      {/* Only when there's something to do here: one quiet row per group is noise on a phone. */}
      {!collapsed &&
        (sessions.length > 1 || editingId !== null || merging) &&
        (merging ? (
          <footer className="elist-foot">
            <span className="muted small">Tick the entries to combine (same day).{pickedList.length > 1 && !sameDay ? " They must be the same day." : ""}</span>
            <span className="spacer" />
            <button className="btn subtle sm" onClick={stopMerging}>
              Cancel
            </button>
            <button
              className="btn primary sm"
              disabled={pickedList.length < 2 || !sameDay}
              onClick={() => {
                a.mergeSessions(pickedList.map((s) => s.id));
                stopMerging();
              }}
            >
              Merge {pickedList.length > 1 ? pickedList.length : ""}
            </button>
          </footer>
        ) : (
          <footer className="elist-foot">
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
            <span className="spacer" />
            {canPush && pushable.length > 1 && (
              <button className="btn sm" onClick={() => onPush(pushable.map((s) => s.id))}>
                Push all {pushable.length}…
              </button>
            )}
            {!canPush && enterable.length > 1 && (
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
          </footer>
        ))}
    </section>
  );
}

function Row({
  session: s,
  now,
  showDate,
  editing,
  onEdit,
  onPush,
  selected,
  onSelect,
  merging,
  picked,
  onPick,
  onMovedDay,
}: {
  session: Session;
  now: number;
  showDate: boolean;
  editing: boolean;
  onEdit: () => void;
  onPush: () => void;
  selected: boolean;
  onSelect: () => void;
  merging: boolean;
  picked: boolean;
  onPick: () => void;
  onMovedDay: (sessionId: Id, day: Ms) => void;
}) {
  const m = useM();
  const a = useA();
  const { fmt, def, columns, target } = layout(m);
  const running = s.end === null;
  const canPush = !!m.config.cwPush;
  const problem = canPush ? pushProblem(m, s) : null;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const fieldDefs = columns.map(def).filter((d): d is FieldDef => !!d);
  // Fields left out of the summary line: where the notes go has a default, and rarely changes.
  const summaryDefs = fieldDefs.filter((d) => d.default === undefined);
  const texts = summaryDefs.flatMap((d) => (s.fields[d.key] ? [fieldText(d, s.fields[d.key], m.view)] : []));
  const missing = summaryDefs.filter((d) => !copyValue(m, d, s.fields[d.key])).map((d) => d.label.toLowerCase());
  const note = firstLine(s.notes, 200);

  return (
    <li ref={ref} className={`elist-item ${selected ? "selected" : ""} ${s.enteredAt ? "entered" : ""}`}>
      <div className="elist-row" onClick={onSelect}>
        {merging && <input type="checkbox" className="elist-pick" checked={picked} onChange={onPick} aria-label="Merge this entry" />}
        <button className="elist-main" onClick={onEdit} aria-expanded={editing} title={`Edit\n\n${plainNote(s.notes).trim() || CONTINUATION}`}>
          <span className="elist-when">
            {showDate && <span className="elist-date">{new Date(s.start).toLocaleDateString([], { month: "numeric", day: "numeric" })}</span>}
            {timeOfDay(s.start)}–{running ? "now" : timeOfDay(s.end!)}
            <span className="elist-hours">{entryHours(durationMs(s, now), fmt.hours)} h</span>
            {running && <span className="elist-running">running</span>}
          </span>
          <span className="elist-what">
            {texts.join(" · ")}
            {missing.length > 0 && <span className="warn">{texts.length ? " · " : ""}needs {missing.join(", ")}</span>}
          </span>
          <span className={`elist-note ${note ? "" : "muted"}`}>{note || CONTINUATION}</span>
        </button>
        {/* Room for them on a wider window: usually what's left to fill in. */}
        <div className="elist-fields" onClick={(e) => e.stopPropagation()}>
          {summaryDefs.map((d) => (
            <FieldInput key={d.key} def={d} value={s.fields[d.key]} resetKey={s.id} onChange={(v) => a.setSessionField(s.id, d.key, v)} />
          ))}
        </div>
        <div className="elist-tools">
          {s.ext?.cw?.removedAt && !s.enteredAt && <span className="warn small nowrap">⚠ Deleted in CW</span>}
          {s.changedSinceEntered && !s.enteredAt && !s.ext?.cw?.removedAt && (
            <span className="warn" title={`Changed after it went to ${target}`}>
              ⚠
            </span>
          )}
          {s.enteredAt ? (
            <button
              className="entered-btn"
              onClick={() => a.updateSession(s.id, { enteredAt: null })}
              title={`Entered ${whenLabel(s.enteredAt, now)}. Click to put it back on To enter.`}
            >
              ✓ {s.ext?.cw?.entryId ? "In CW" : "Entered"}
            </button>
          ) : canPush ? (
            !problem && (
              <button className="btn primary sm" onClick={onPush} title={isUpdate(s) ? `Update the entry in ${target}` : `Add this to the ticket in ${target}`}>
                {isUpdate(s) ? "Update…" : "Push…"}
              </button>
            )
          ) : (
            !running && (
              <button className="btn sm" onClick={() => a.updateSession(s.id, { enteredAt: Date.now() })} title={`Done in ${target}`}>
                ✓ Entered
              </button>
            )
          )}
        </div>
      </div>
      {editing && (
        <div className="elist-editor">
          <SessionEditor session={s} onDone={onEdit} onMovedDay={(d) => onMovedDay(s.id, d)} />
        </div>
      )}
    </li>
  );
}
