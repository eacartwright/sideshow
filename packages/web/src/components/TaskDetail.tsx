import { durationMs, startOfDay, type Id, type Session } from "@sideshow/shared";
import { useState } from "react";
import { dayLabel, hm, timeOfDay } from "../format";
import { sessionFieldTexts, useA, useM, useNow } from "../model";
import { NewTicketButton } from "./CreateTicket";
import { Dialog } from "./Dialog";
import { DraftInput, DraftTextarea, ProjectPicker, TaskFieldInputs, TicketInfo } from "./fields";
import { defaultManualSpan, SessionEditor } from "./SessionEditor";

// Everything about one task: its fields, and its sessions grouped by day.
// Tap a session to edit it. In Merge mode, tap one and then another: everything
// between is selected and can be merged.

export function TaskDetail({ taskId, onClose }: { taskId: Id; onClose: () => void }) {
  const m = useM();
  const a = useA();
  const now = useNow(1000);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [edge, setEdge] = useState<number | null>(null);
  const [merging, setMerging] = useState(false);
  const [editingId, setEditingId] = useState<Id | null>(null);
  const info = m.tasks.get(taskId);
  if (!info) return null;
  const { task } = info;
  const running = m.running.find((s) => s.taskId === taskId);

  // Selection is a range over the task's sessions in time order.
  const chrono = info.sessions;
  const lo = anchor === null ? -1 : Math.min(anchor, edge ?? anchor);
  const hi = anchor === null ? -1 : Math.max(anchor, edge ?? anchor);
  const selected = anchor === null ? [] : chrono.slice(lo, hi + 1);
  const sameDay = selected.every((s) => startOfDay(s.start) === startOfDay(selected[0]!.start));
  const clear = () => {
    setAnchor(null);
    setEdge(null);
  };
  const tap = (i: number) => {
    if (anchor === null || edge !== null) {
      // Start a new selection (or clear if tapping the lone selected one).
      if (anchor === i && edge === null) return clear();
      setAnchor(i);
      setEdge(null);
    } else if (i === anchor) clear();
    else setEdge(i);
  };

  const days = new Map<number, { s: Session; i: number }[]>();
  for (let i = chrono.length - 1; i >= 0; i--) {
    const s = chrono[i]!;
    const d = startOfDay(s.start);
    days.set(d, [...(days.get(d) ?? []), { s, i }]);
  }

  return (
    <Dialog title="Task" onClose={onClose} className="detail">
      <div className="stack">
        <DraftInput
          className="title-input"
          value={info.titleText}
          placeholder="Title"
          title={task.title ? undefined : "From the notes until you edit it"}
          aria-label="Title"
          onValue={(title) => a.updateTask(taskId, { title })}
        />
        <div className="row-actions">
          <ProjectPicker value={task.projectId ?? null} onChange={(projectId) => a.updateTask(taskId, { projectId })} />
          <TaskFieldInputs task={task} />
          {m.profile.connectwise && !task.fields[m.profile.connectwise.ticketField] && <NewTicketButton taskId={taskId} />}
        </div>
        <TicketInfo task={task} />
        <DraftTextarea
          className="description"
          value={task.description}
          placeholder="Description (optional context)"
          aria-label="Description"
          onValue={(description) => a.updateTask(taskId, { description })}
        />
        <div className="row-actions">
          {running ? (
            <button className="btn pause" onClick={() => a.pause(running.id)}>
              ❚❚ Pause
            </button>
          ) : (
            <button
              className="btn primary"
              onClick={(e) => {
                // Same as the list's ▶: adds to what's running; Shift switches.
                a.continueTask(taskId, !e.shiftKey);
                onClose();
              }}
            >
              ▶ {info.sessions.length ? "Continue" : "Start"}
            </button>
          )}
          {(running || task.pausedAt) && (
            <button className="btn subtle" onClick={() => a.stop({ sessionId: running?.id, taskId })} title="Stop and take it off the Now stack">
              ■ Stop
            </button>
          )}
          <span className="spacer" />
          {task.status === "open" ? (
            <button
              className="btn"
              onClick={() => {
                a.updateTask(taskId, { status: "done" });
                onClose();
              }}
            >
              Mark done
            </button>
          ) : (
            <button className="btn" onClick={() => a.updateTask(taskId, { status: "open" })}>
              Reopen
            </button>
          )}
          {task.status !== "archived" && (
            <button
              className="btn"
              onClick={() => {
                a.updateTask(taskId, { status: "archived" });
                onClose();
              }}
            >
              Archive
            </button>
          )}
        </div>
      </div>

      <div className="row-actions">
        <button
          className="btn subtle"
          onClick={() => {
            const { start, end } = defaultManualSpan(null);
            setMerging(false);
            clear();
            setEditingId(a.createSession(taskId, start, end));
          }}
        >
          + Add time
        </button>
        {chrono.length > 1 && !merging && (
          <button
            className="btn subtle"
            onClick={() => {
              setEditingId(null);
              setMerging(true);
            }}
          >
            Merge…
          </button>
        )}
      </div>

      {merging && (
        <div className={`merge-bar ${selected.length ? "on" : ""}`} role="status">
          {selected.length === 0 ? (
            <>
              <span className="muted small">Tap two sessions to select them and everything between, then merge.</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setMerging(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <span>
                <strong>{selected.length}</strong> selected ·{" "}
                {hm(selected.reduce((t, s) => t + durationMs(s, now), 0))}
                {!sameDay && <span className="warn"> · must be the same day</span>}
              </span>
              <span className="spacer" />
              <button
                className="btn"
                onClick={() => {
                  clear();
                  setMerging(false);
                }}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={selected.length < 2 || !sameDay}
                onClick={() => {
                  a.mergeSessions(selected.map((s) => s.id));
                  clear();
                  setMerging(false);
                }}
              >
                Merge
              </button>
            </>
          )}
        </div>
      )}

      <div className="days">
        {chrono.length === 0 && <p className="empty">Not started yet.</p>}
        {[...days].map(([day, rows]) => (
          <section key={day}>
            <h3>
              {dayLabel(day)}{" "}
              <span className="muted">{hm(rows.reduce((t, r) => t + durationMs(r.s, now), 0))}</span>
            </h3>
            <ul>
              {rows.map(({ s, i }) => {
                const on = merging && i >= lo && i <= hi;
                const editing = !merging && editingId === s.id;
                return (
                  <li key={s.id}>
                    <button
                      className={`session ${on || editing ? "selected" : ""}`}
                      aria-pressed={merging ? on : editing}
                      onClick={() => (merging ? tap(i) : setEditingId(editing ? null : s.id))}
                    >
                      <span className="muted small">
                        {timeOfDay(s.start)}–{s.end ? timeOfDay(s.end) : "now"} · {hm(durationMs(s, now))}
                        {sessionFieldTexts(m, s).map((x) => ` · ${x}`)}
                      </span>
                      <span className={`pre ${s.notes ? "" : "muted"}`}>
                        {s.notes || "Continuation of previous work"}
                      </span>
                      {s.enteredAt ? (
                        <span className="entered-label small">✓ Entered</span>
                      ) : (
                        s.changedSinceEntered && <span className="warn small">⚠ Changed since entered</span>
                      )}
                    </button>
                    {editing && <SessionEditor session={s} onDone={() => setEditingId(null)} />}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
