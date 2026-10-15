import { durationMs, startOfDay, type Id } from "@sideshow/shared";
import { useEffect, useState } from "react";
import { dayLabel, hm } from "../format";
import { useA, useM, type CwBoard, type PushResult } from "../model";
import { showToast } from "../toast";
import { Dialog } from "./Dialog";
import { FieldInput, linkedCompanyId } from "./fields";
import { entryProblem } from "./PushDialog";
import { Spinner } from "./Spinner";

// Make a CW ticket for a task (DESIGN.md §10, "Creating a ticket from a task"): summary from
// the title, company from the task's linked client, board / type / status, owner = me unless
// removed (then it waits in the board's queue). CW doesn't email anyone about it. Time the task
// already has goes onto the new ticket too, unless unticked.

const SUMMARY_MAX = 100;
const BOARD_KEY = "sideshow:cwBoard";

function lastBoard(): number | null {
  try {
    return Number(localStorage.getItem(BOARD_KEY)) || null;
  } catch {
    return null;
  }
}

/** "New ticket…": shown where a task has no ticket # yet and CW is on. */
export function NewTicketButton({ taskId, className = "btn subtle" }: { taskId: Id; className?: string }) {
  const m = useM();
  const [open, setOpen] = useState(false);
  if (!m.config.cw || !m.profile.connectwise) return null;
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} title="Create a ticket in ConnectWise for this task">
        New ticket…
      </button>
      {open && <CreateTicketDialog taskId={taskId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function CreateTicketDialog({ taskId, onClose }: { taskId: Id; onClose: () => void }) {
  const m = useM();
  const a = useA();
  const info = m.tasks.get(taskId);
  const [summary, setSummary] = useState(() => (info?.titleText ?? "").trim().slice(0, SUMMARY_MAX));
  const [description, setDescription] = useState(() => info?.task.description ?? "");
  const [boards, setBoards] = useState<CwBoard[] | null>(null);
  const [owner, setOwner] = useState<{ id: number; name: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<number | null>(null);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [statusId, setStatusId] = useState<number | null>(null);
  const [assign, setAssign] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState(true);
  /** After a ticket was made but some entries didn't go: what happened, shown before closing. */
  const [outcome, setOutcome] = useState<{ ticketId: number; pushed: PushResult[]; pushError?: string } | null>(null);

  const board = boards?.find((b) => b.id === boardId);
  const chooseBoard = (b: CwBoard | undefined) => {
    setBoardId(b?.id ?? null);
    setTypeId(b?.types.find((t) => t.default)?.id ?? null);
    setStatusId(b?.statuses.find((s) => s.default)?.id ?? b?.statuses[0]?.id ?? null);
  };

  useEffect(() => {
    let live = true;
    void a.cwBoards().then((res) => {
      if (!live) return;
      if ("error" in res) return setLoadError(res.error);
      setBoards(res.boards);
      setOwner(res.owner);
      if (!res.owner) setAssign(false);
      const last = lastBoard();
      chooseBoard(res.boards.find((b) => b.id === last) ?? res.boards.find((b) => b.name === "Tier 1") ?? res.boards[0]);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!info) return null;
  const cw = m.profile.connectwise!;
  const clientDef = m.profile.fields.find((f) => f.key === cw.clientField);
  const clientId = cw.clientField ? info.task.fields[cw.clientField] : undefined;
  const client = clientId ? m.view.lists[String(clientId)] : undefined;
  const linked = linkedCompanyId(client) !== undefined;
  const hasTicket = !!info.task.fields[cw.ticketField];
  // The task's time not entered anywhere yet: pushed to the new ticket if ticked.
  const unentered = info.sessions.filter((s) => !s.deleted && !s.enteredAt);
  const ready = m.config.cwPush ? unentered.filter((s) => !entryProblem(m, s)) : [];
  const notReady = m.config.cwPush ? unentered.filter((s) => entryProblem(m, s)) : [];
  const days = [...new Set(ready.map((s) => startOfDay(s.start)))].map((d) => dayLabel(d));
  const readyTime = ready.reduce((t, s) => t + durationMs(s, Date.now()), 0);
  const why = [...new Set(notReady.map((s) => entryProblem(m, s)!.toLowerCase()))].join(", ");
  const problem = hasTicket
    ? "This task has a ticket already."
    : !client
      ? `Pick the ${clientDef?.label.toLowerCase() ?? "client"} first.`
      : !linked
        ? `${client.name} isn't a ConnectWise company: pick the ${clientDef?.label.toLowerCase() ?? "company"} again from the list.`
        : !summary.trim()
          ? "The ticket needs a summary."
          : null;

  const create = async () => {
    if (!board || problem) return;
    setBusy(true);
    setError(null);
    const res = await a.createCwTicket({
      taskId,
      summary: summary.trim(),
      boardId: board.id,
      typeId: typeId ?? undefined,
      statusId: statusId ?? undefined,
      assign,
      description: description.trim() || undefined,
      pushSessionIds: push && ready.length ? ready.map((s) => s.id) : undefined,
    });
    setBusy(false);
    if ("error" in res) return setError(res.error);
    try {
      localStorage.setItem(BOARD_KEY, String(board.id));
    } catch {
      // Not remembered: Tier 1 next time.
    }
    const pushed = res.pushed ?? [];
    const ok = pushed.filter((r) => r.ok).length;
    if (res.pushError || pushed.some((r) => !r.ok)) return setOutcome({ ticketId: res.ticketId, pushed, pushError: res.pushError });
    showToast(ok ? `Created ticket #${res.ticketId} and pushed ${ok === 1 ? "its entry" : `${ok} entries`}` : `Created ticket #${res.ticketId}`);
    onClose();
  };

  if (outcome) {
    const ok = outcome.pushed.filter((r) => r.ok).length;
    return (
      <Dialog title="New ConnectWise ticket" onClose={onClose} className="new-ticket">
        <div className="stack">
          <p>
            Created ticket <strong>#{outcome.ticketId}</strong>
            {ok ? `, and pushed ${ok === 1 ? "1 entry" : `${ok} entries`} to it` : ""}.
          </p>
          {outcome.pushError && <p className="warn">{outcome.pushError}</p>}
          {outcome.pushed
            .filter((r) => !r.ok)
            .map((r) => {
              const s = m.view.sessions[r.sessionId];
              return (
                <p key={r.sessionId} className="warn">
                  {s ? `${dayLabel(s.start)}, ${hm(durationMs(s, Date.now()))}: ` : ""}
                  {r.error ?? "Couldn't push"}. Push it from the Day page once it's fixed.
                </p>
              );
            })}
          <div className="row-actions">
            <span className="spacer" />
            <button className="btn primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="New ConnectWise ticket" onClose={onClose} className="new-ticket">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label className="field">
          <span className="field-label">Summary</span>
          <input
            className="title-input"
            value={summary}
            maxLength={SUMMARY_MAX}
            onChange={(e) => setSummary(e.target.value)}
            autoFocus
          />
          {summary.length > SUMMARY_MAX - 15 && (
            <span className="muted small">
              {summary.length} of {SUMMARY_MAX}
            </span>
          )}
        </label>

        <div className="field">
          <span className="field-label">Company</span>
          <span className="row-actions">
            {clientDef && (
              <FieldInput
                def={clientDef}
                value={clientId}
                onChange={(v) => a.setTaskField(taskId, clientDef.key, v)}
              />
            )}
            {client && !linked && <span className="warn small">Not linked to ConnectWise</span>}
          </span>
        </div>

        {loadError && <p className="warn">{loadError}</p>}
        {!boards && !loadError && (
          <p className="muted small busy-line" role="status">
            <Spinner /> Loading boards from ConnectWise…
          </p>
        )}
        {boards && (
          <div className="new-ticket-grid">
            <label className="field">
              <span className="field-label">Board</span>
              <select className="select" value={boardId ?? ""} onChange={(e) => chooseBoard(boards.find((b) => b.id === Number(e.target.value)))}>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Type</span>
              <select className="select" value={typeId ?? ""} onChange={(e) => setTypeId(Number(e.target.value) || null)}>
                <option value="">None</option>
                {board?.types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Status</span>
              <select className="select" value={statusId ?? ""} onChange={(e) => setStatusId(Number(e.target.value) || null)}>
                {board?.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="field">
          <span className="field-label">Owner</span>
          <span className="row-actions">
            {assign && owner ? (
              <span className="chip chip-set owner-chip">
                {owner.name}
                <button type="button" className="chip-x" onClick={() => setAssign(false)} aria-label={`Don't assign it to ${owner.name}`} title="Leave it unassigned">
                  ✕
                </button>
              </span>
            ) : (
              <>
                <span className="muted">Unassigned: it waits in {board ? `the ${board.name} queue` : "the board's queue"}</span>
                {owner && (
                  <button type="button" className="btn subtle" onClick={() => setAssign(true)}>
                    Assign to {owner.name}
                  </button>
                )}
              </>
            )}
          </span>
        </div>

        <label className="field">
          <span className="field-label">Description (optional)</span>
          <textarea className="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's the issue?" />
        </label>

        {ready.length > 0 && (
          <label className="check-row">
            <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} />
            <span>
              Push its {ready.length === 1 ? "time entry" : `${ready.length} time entries`} to the new ticket
              <span className="muted small">
                {" "}
                ({days.join(", ")} · {hm(readyTime)})
              </span>
            </span>
          </label>
        )}
        {notReady.length > 0 && (
          <p className="muted small">
            {notReady.length === 1 ? "1 entry" : `${notReady.length} entries`} can't go yet ({why}); push{" "}
            {notReady.length === 1 ? "it" : "them"} from the Day page later.
          </p>
        )}

        <p className="muted small">ConnectWise won't email the contact or anyone else about the ticket. The contact is the company's default.</p>
        {problem && <p className="warn">{problem}</p>}
        {error && <p className="warn">{error}</p>}

        <div className="row-actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary busy-line" disabled={busy || !!problem || !board}>
            {busy && <Spinner />}
            {busy ? (push && ready.length ? "Creating and pushing…" : "Creating…") : "Create ticket"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
