import { durationMs, firstLine, ticketNumber, type Id, type Session } from "@sideshow/shared";
import { useState } from "react";
import { entryDate, entryHours, entryTime } from "../format";
import { fieldText, useA, useM, type Model, type PushResult } from "../model";
import { Dialog } from "./Dialog";

// Pushing time entries to ConnectWise (DESIGN.md §10, M4). Always through this preview: it
// shows exactly what each entry will be (ticket, times, work type, billing, where the notes go,
// whether CW emails anyone) and what can't go yet, then the result for each one.

/** The value a session field has, counting the profile's default ("Internal"). */
export function sessionValue(m: Model, s: Session, key: string | undefined) {
  if (!key) return undefined;
  return s.fields[key] ?? m.profile.fields.find((f) => f.key === key)?.default;
}

/** Why a session can't be pushed yet, or null. The server checks the same things. */
export function pushProblem(m: Model, s: Session): string | null {
  const cw = m.profile.connectwise;
  if (!cw) return "No ConnectWise settings";
  const task = m.view.tasks[s.taskId];
  if (s.end !== null && (!task || !ticketNumber(String(task.fields[cw.ticketField] ?? "")))) return "No ticket #";
  return entryProblem(m, s);
}

/** pushProblem without the ticket #: what a session needs before any ticket will take it. */
export function entryProblem(m: Model, s: Session): string | null {
  const cw = m.profile.connectwise;
  if (!cw) return "No ConnectWise settings";
  if (s.end === null) return "Still running";
  if (cw.workTypeField && !sessionValue(m, s, cw.workTypeField)) return "No work type";
  if (cw.billingField && !sessionValue(m, s, cw.billingField)) return "No billing";
  return null;
}

/** Pushed before (has a CW entry) and edited since: the push updates that entry. */
export const isUpdate = (s: Session) => !!s.ext?.cw?.entryId && !s.enteredAt;

export function PushDialog({ sessionIds, onClose, onDone }: { sessionIds: Id[]; onClose: () => void; onDone: (pushed: Id[]) => void }) {
  const m = useM();
  const a = useA();
  const cw = m.profile.connectwise!;
  const fmt = m.profile.entryFormat;
  const [state, setState] = useState<"ready" | "pushing" | "done">("ready");
  const [results, setResults] = useState<Map<Id, PushResult>>(() => new Map());
  const [error, setError] = useState<string | null>(null);

  const sessions = sessionIds
    .map((id) => m.view.sessions[id])
    .filter((s): s is Session => !!s && !s.deleted)
    .sort((x, y) => x.start - y.start);
  const ready = sessions.filter((s) => !pushProblem(m, s));
  const emailing = ready.filter((s) => s.ext?.cw?.email === true && !isUpdate(s));
  const def = (k?: string) => m.profile.fields.find((f) => f.key === k);

  const push = async () => {
    setState("pushing");
    setError(null);
    const r = await a.pushToCw(ready.map((s) => s.id));
    if ("error" in r) {
      setError(r.error);
      setState("ready");
      return;
    }
    setResults(new Map(r.results.map((x) => [x.sessionId, x])));
    setState("done");
    onDone(r.results.filter((x) => x.ok).map((x) => x.sessionId));
  };
  const failed = [...results.values()].filter((r) => !r.ok).length;

  return (
    <Dialog title={state === "done" ? "Pushed to ConnectWise" : `Push ${ready.length} ${ready.length === 1 ? "entry" : "entries"} to ConnectWise`} onClose={onClose} className="push-dialog">
      <table className="push-table">
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Date</th>
            <th>Time</th>
            <th>Hours</th>
            <th>Work type</th>
            <th>Billing</th>
            <th>Notes to</th>
            <th>Notes</th>
            <th>{state === "done" ? "Result" : ""}</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const task = m.view.tasks[s.taskId]!;
            const problem = pushProblem(m, s);
            const result = results.get(s.id);
            const email = s.ext?.cw?.email === true && !isUpdate(s);
            const workType = def(cw.workTypeField);
            const billing = def(cw.billingField);
            return (
              <tr key={s.id} className={problem ? "blocked" : ""}>
                <td className="nowrap">#{ticketNumber(String(task.fields[cw.ticketField] ?? "")) || "—"}</td>
                <td className="nowrap">{entryDate(s.start, fmt?.date ?? "MM/DD/YYYY")}</td>
                <td className="nowrap">
                  {entryTime(s.start, fmt?.time ?? "h:mm A")}–{s.end ? entryTime(s.end, fmt?.time ?? "h:mm A") : "now"}
                </td>
                <td className="nowrap">{entryHours(durationMs(s, Date.now()), "decimal")}</td>
                <td>{workType ? fieldText(workType, s.fields[workType.key], m.view) : ""}</td>
                <td className="nowrap">{billing ? String(sessionValue(m, s, billing.key) ?? "") : ""}</td>
                <td className="nowrap">
                  {String(sessionValue(m, s, cw.noteToField) ?? "Internal")}
                  {email && <span className="push-email"> · ✉ emails</span>}
                </td>
                <td className="push-notes">{firstLine(s.notes) || <span className="muted">Continuation of previous work</span>}</td>
                <td className="nowrap">
                  {result ? (
                    result.ok ? (
                      <span className="entered-label">
                        ✓ {result.action === "updated" ? "Updated" : "Added"} #{result.entryId}
                      </span>
                    ) : (
                      <span className="warn">✗ {result.error}</span>
                    )
                  ) : problem ? (
                    <span className="warn">Can't push: {problem}</span>
                  ) : isUpdate(s) ? (
                    <span className="muted small">Updates #{String(s.ext!.cw!.entryId)}</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {state !== "done" && emailing.length > 0 && (
        <p className="warn small">
          ✉ {emailing.length} {emailing.length === 1 ? "entry emails" : "entries email"} the ticket's contact, CCs and resources.
        </p>
      )}
      {state !== "done" && ready.length < sessions.length && (
        <p className="muted small">Entries marked “Can't push” are skipped; fix them in the table and push again.</p>
      )}
      {error && <p className="warn small">{error}</p>}
      {state === "done" && failed > 0 && <p className="warn small">{failed} didn't go through; they stay on the To enter list.</p>}

      <div className="row-actions">
        <span className="spacer" />
        {state === "done" ? (
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose} disabled={state === "pushing"}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => void push()} disabled={!ready.length || state === "pushing"}>
              {state === "pushing" ? "Pushing…" : `Push ${ready.length} to ConnectWise`}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
