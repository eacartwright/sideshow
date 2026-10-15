import { durationMs, firstLine, startOfDay, ticketNumber, type FieldDef, type FieldValue, type Id, type Session } from "@sideshow/shared";
import { useState } from "react";
import { clock, dayLabel, hm, timeOfDay } from "../format";
import { taskTotals, useA, useM, useNow, type TaskInfo } from "../model";
import { at, timeValue } from "./SessionEditor";
import { DraftInput, SessionFieldInputs, TaskFieldInputs, TicketInfo, TicketLinks } from "./fields";
import { NoteView } from "./NoteView";
import { RichNotes } from "./RichNotes";
import { useWeekly } from "../weekly";

// The top of the app: one card per running task, most recently started on top,
// then a compact card per paused task. Pausing (or switching away) keeps a task here;
// only Stop takes it off.
// Cards are keyed by position, not by session, so the top card's notes textarea
// stays mounted across switches (and while idle). That lets ▶ New focus it inside
// the tap itself, which is what makes the iPhone keyboard appear.

export function NowPanel({ onAlongside, onOpen }: { onAlongside: () => void; onOpen: (taskId: Id) => void }) {
  const m = useM();
  const a = useA();
  const now = useNow(1000);
  const cards: (Session | null)[] = m.running.length ? m.running : [null];

  return (
    <div className="now-stack">
      {cards.map((s, i) => (
        <NowCard key={i} session={s} top={i === 0} now={now} />
      ))}
      {m.paused.map((info) => (
        <PausedCard key={info.task.id} info={info} now={now} onOpen={onOpen} />
      ))}
      {(m.running.length > 0 || m.paused.length > 0) && (
        <div className="now-foot">
          {m.running.length > 0 && (
            <button className="btn subtle" onClick={onAlongside} title="Start another task without stopping this one (Alt+Shift+N for a blank one)">
              + Also working on…
            </button>
          )}
          {m.running.length > 1 && (
            <button className="btn subtle pause-all" onClick={() => a.pause()} title="Pause everything running; they stay here">
              ❚❚ Pause all
            </button>
          )}
          {m.running.length + m.paused.length > 1 && (
            <button className="btn subtle" onClick={() => a.stop()}>
              Stop all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NowCard({ session, top, now }: { session: Session | null; top: boolean; now: number }) {
  const m = useM();
  const a = useA();
  const info = session ? m.tasks.get(session.taskId) : undefined;
  const earlier = info && session ? info.sessions.filter((s) => s.id !== session.id).reverse() : [];
  const running = session && info ? { session, info } : null;

  return (
    <section className={`now ${running ? "is-running" : "is-idle"} ${top ? "" : "compact"}`} aria-label="Now" data-session={session?.id}>
      {running ? <RunningHead {...running} now={now} /> : <IdleHead />}

      <RichNotes
        editorRef={top ? a.notesRef : undefined}
        className="notes"
        toolbar="focus"
        value={session?.notes ?? ""}
        resetKey={session?.id ?? null}
        placeholder={
          session
            ? earlier.length
              ? "Continuing… (leave empty for “continuation of previous work”)"
              : "What are you doing? Notes save as you type."
            : "Start typing to start a new task…"
        }
        label="Session notes"
        onValue={(notes) => {
          const id = session?.id ?? a.startNew();
          if (id) a.updateSession(id, { notes });
        }}
      />

      {earlier.length > 0 && (
        <details className="earlier">
          <summary>
            Earlier on this task · {earlier.length} session{earlier.length === 1 ? "" : "s"} ·{" "}
            {hm(earlier.reduce((t, s) => t + durationMs(s, now), 0))}
          </summary>
          <ul>
            {earlier.slice(0, 10).map((s) => (
              <li key={s.id}>
                <div className="muted small">
                  {dayLabel(s.start)} · {timeOfDay(s.start)}–{s.end ? timeOfDay(s.end) : "now"} ·{" "}
                  {hm(durationMs(s, now))}
                </div>
                {s.notes.trim() ? <NoteView markdown={s.notes} /> : <div className="muted">Continuation of previous work</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function IdleHead() {
  return (
    <div className="now-top">
      <span className="idle-dot" aria-hidden />
      <span className="idle-label">Nothing running</span>
    </div>
  );
}

/** How long a session runs before changing its work type asks "new entry, or fix this one?". */
const ASK_AFTER_MS = 60_000;

function RunningHead({ session, info, now }: { session: Session; info: TaskInfo; now: number }) {
  const m = useM();
  const a = useA();
  // A work type change waiting on "new entry from now, or fix this entry?".
  const [ask, setAsk] = useState<{ sessionId: Id; def: FieldDef; value: FieldValue } | null>(null);
  const asking = ask?.sessionId === session.id ? ask : null;
  const splitField = m.profile.fields.find((d) => d.on === "session" && d.newEntry);
  // WRIT: this was really this week's recurring internal ticket.
  const weekly = useWeekly(!!m.config.cwWeekly);
  const ticketField = m.profile.connectwise?.ticketField;
  const isWeekly = !!weekly && !!ticketField && ticketNumber(String(info.task.fields[ticketField] ?? "")) === String(weekly.ticket);

  const newEntry = () => {
    const id = a.newEntry(session.id);
    setAsk(null);
    if (!id || !splitField) return;
    // Straight to the next entry's work type.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLSelectElement>(`[data-session="${id}"] select[data-field="${splitField.key}"]`);
      if (!el) return;
      el.focus();
      try {
        el.showPicker();
      } catch {
        // Not every browser opens a select this way; focused is enough.
      }
    });
  };
  const onField = (def: FieldDef, value: FieldValue | null) => {
    const had = session.fields[def.key];
    if (def.newEntry && value !== null && value !== "" && had !== undefined && had !== value && now - session.start >= ASK_AFTER_MS) {
      setAsk({ sessionId: session.id, def, value });
    } else {
      a.setSessionField(session.id, def.key, value);
    }
  };
  const valueName = (def: FieldDef, v: FieldValue) =>
    (def.list ? m.lists.get(def.list)?.find((x) => x.id === v)?.name : undefined) ?? String(v);

  return (
    <>
      <div className="now-top">
        <span className="live-dot" aria-hidden />
        <span className="timer" aria-label="Elapsed">
          {clock(now - session.start)}
        </span>
        <span className="spacer" />
        <button className="btn pause" onClick={() => a.pause(session.id)} title="Pause: stop the clock, keep it here (Alt+P pauses the top one)">
          ❚❚ Pause
        </button>
        <button
          className="btn subtle icon"
          onClick={() => a.stop({ sessionId: session.id, taskId: info.task.id })}
          title="Stop and take it off the Now stack"
          aria-label="Stop"
        >
          ■
        </button>
      </div>
      <StartedLine session={session} info={info} now={now} />
      <DraftInput
        className="title-input"
        value={info.titleText}
        resetKey={info.task.id}
        placeholder="Title"
        title={info.task.title ? undefined : "From the notes until you edit it"}
        aria-label="Task title"
        onValue={(title) => a.updateTask(info.task.id, { title })}
      />
      <div className="now-meta">
        <TaskFieldInputs task={info.task} />
        <TicketLinks task={info.task} />
        <SessionFieldInputs session={session} onChange={onField} />
        {m.config.cwWeekly && !isWeekly && (
          <button
            className="btn subtle"
            onClick={() => a.moveToWeekly(session.id)}
            title={`Move this entry, notes and all, to this week's recurring internal ticket${weekly ? ` (#${weekly.ticket})` : ""} (Alt+W)`}
          >
            WRIT
          </button>
        )}
        <button
          className="btn subtle"
          onClick={newEntry}
          title={`End this entry now and start another on the same task${splitField ? `, then pick its ${splitField.label.toLowerCase()}` : ""}`}
        >
          New entry
        </button>
      </div>
      {asking && (
        <div
          className="new-entry-ask"
          role="group"
          aria-label={`${asking.def.label}: ${valueName(asking.def, asking.value)}`}
          onKeyDown={(e) => e.key === "Escape" && setAsk(null)}
        >
          <span className="new-entry-q">
            {asking.def.label}: <strong>{valueName(asking.def, asking.value)}</strong>
          </span>
          <button
            className="btn primary"
            autoFocus
            onClick={() => {
              a.newEntry(session.id, { [asking.def.key]: asking.value });
              setAsk(null);
            }}
            title={`Keep ${valueName(asking.def, session.fields[asking.def.key]!)} until now; a new entry starts now`}
          >
            New entry from {timeOfDay(now)}
          </button>
          <button
            className="btn"
            onClick={() => {
              a.setSessionField(session.id, asking.def.key, asking.value);
              setAsk(null);
            }}
            title={`Change it for this whole entry, since ${timeOfDay(session.start)}`}
          >
            Change this whole entry
          </button>
          <button className="btn subtle" onClick={() => setAsk(null)}>
            Cancel
          </button>
        </div>
      )}
      <TicketInfo task={info.task} refreshButton={false} />
    </>
  );
}

/** "Started 9:12 · …"; tap the time to correct it ("I actually started 10 minutes ago"). */
function StartedLine({ session, info, now }: { session: Session; info: TaskInfo; now: number }) {
  const a = useA();
  const [editing, setEditing] = useState(false);
  const total = <span>{hm(taskTotals(info, now).onDay)} on this task today</span>;
  // Earlier is always fine; later only up to now.
  const setStart = (t: number | null) => {
    if (t !== null && t <= Date.now()) a.updateSession(session.id, { start: t });
  };
  if (!editing) {
    return (
      <div className="muted small since">
        <button className="since-btn" onClick={() => setEditing(true)} title="Change when this started">
          Started {timeOfDay(session.start)}
        </button>{" "}
        · {total}
      </div>
    );
  }
  return (
    <div className="since since-edit">
      <label className="muted small" htmlFor={`start-${session.id}`}>
        Started
      </label>
      <input
        id={`start-${session.id}`}
        type="time"
        className="editor-input"
        value={timeValue(session.start)}
        onChange={(e) => setStart(at(startOfDay(session.start), e.target.value))}
      />
      <button className="btn" onClick={() => setStart(session.start - 5 * 60_000)}>
        −5 min
      </button>
      <button className="btn" disabled={session.start + 5 * 60_000 > now} onClick={() => setStart(session.start + 5 * 60_000)}>
        +5 min
      </button>
      <button className="btn primary" onClick={() => setEditing(false)}>
        Done
      </button>
    </div>
  );
}

function PausedCard({ info, now, onOpen }: { info: TaskInfo; now: number; onOpen: (taskId: Id) => void }) {
  const a = useA();
  const last = info.sessions[info.sessions.length - 1];
  const meta = [info.groupItem?.name, `paused ${timeOfDay(info.task.pausedAt!)}`, `${hm(taskTotals(info, now).onDay)} today`].filter(Boolean);
  // An untitled task already shows its notes as the title.
  const preview = last && !info.titleDerived ? firstLine(last.notes) : "";
  return (
    <section className="now is-paused" aria-label={`Paused: ${info.title}`}>
      <span className="pause-mark" aria-hidden>
        ❚❚
      </span>
      <button className="paused-main" onClick={() => onOpen(info.task.id)} title="Open details">
        <span className="row-title">{info.title}</span>
        <span className="row-meta">{meta.join(" · ")}</span>
        {preview && <span className="row-meta">{preview}</span>}
      </button>
      <button
        className="btn resume"
        // Like the list's ▶: adds to what's running; Shift switches (pauses the others).
        onClick={(e) => a.continueTask(info.task.id, !e.shiftKey)}
        title="Resume alongside what's running (Shift+click to switch to just this)"
        aria-label={`Resume ${info.title}`}
      >
        ▶<span className="resume-label"> Resume</span>
      </button>
      <button className="btn subtle icon" onClick={() => a.stop({ taskId: info.task.id })} title="Stop and take it off the Now stack" aria-label={`Stop ${info.title}`}>
        ■
      </button>
    </section>
  );
}
