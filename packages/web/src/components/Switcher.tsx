import { matchesQuery, startOfDay, ticketNumber, type Session } from "@sideshow/shared";
import { useEffect, useRef, useState } from "react";
import { hm, plural, timeOfDay, whenLabel } from "../format";
import { taskTotals, useA, useM, type TaskInfo } from "../model";
import type { TicketHit } from "../tickets";
import { Dialog } from "./Dialog";
import { at, dateValue, timeValue } from "./SessionEditor";
import { TicketPicker, TicketRow, useTicketSearch } from "./TicketPicker";
import { TicketView } from "./TicketView";

// Find any task and continue it, or start a new one with what you typed.
// Ctrl+K or / on desktop, Find on the phone. In "alongside" mode (or with Shift),
// whatever is running keeps running. With a `span` (a drag across empty space on the Day
// page's calendar) it doesn't touch the clock: the pick gets a session covering that span.
// With `move` (Move to… on a session) the pick gets that session instead.
// With ConnectWise, tickets are found here too: your open ones with nothing typed, matches as you
// type, listed after the tasks you already have.

type Item = { kind: "task"; info: TaskInfo } | { kind: "new"; title: string } | { kind: "ticket"; ticket: TicketHit };

export function Switcher({
  alongside = false,
  span,
  onAdded,
  move,
  onClose,
}: {
  alongside?: boolean;
  /** Add this span of time to the picked task instead of starting it. */
  span?: { start: number; end: number };
  /** With a span: the new session's id, and when it starts (the span may have been changed). */
  onAdded?: (sessionId: string, start: number) => void;
  /** Move this session to the picked task (or a new one) instead. */
  move?: Session;
  onClose: () => void;
}) {
  const m = useM();
  const a = useA();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  const [viewing, setViewing] = useState<{ ticket: TicketHit; along: boolean } | null>(null);
  // The span can be changed here: the day, the start and the end.
  const [when, setWhen] = useState(span);
  const listRef = useRef<HTMLUListElement>(null);
  const now = Date.now();
  const runningIds = new Set(m.running.map((s) => s.taskId));

  const query = q.trim();
  const tasks = (
    query
      ? m.recent.filter((t) => matchesQuery(t.haystack, query)).slice(0, 50)
      : m.recent.filter((t) => t.task.status === "open" && !(alongside && runningIds.has(t.task.id))).slice(0, 30)
  ).filter((t) => t.task.id !== move?.taskId);
  const items: Item[] = tasks.map((info) => ({ kind: "task" as const, info }));
  // From CW: not ones a task above is already on.
  const cwOn = !!m.config.cw;
  const { results, busy } = useTicketSearch(cwOn && (query.length >= 2 || !query) ? (query ? { q: query } : { mine: true }) : null);
  const ticketField = m.profile.connectwise?.ticketField;
  const shown = new Set(ticketField ? tasks.map((t) => ticketNumber(String(t.task.fields[ticketField] ?? ""))) : []);
  const hits = (results?.tickets ?? []).filter((t) => !shown.has(String(t.id))).slice(0, query ? 25 : 15);
  for (const ticket of hits) items.push({ kind: "ticket", ticket });
  if (query) items.push({ kind: "new", title: query });
  else if (alongside) items.unshift({ kind: "new", title: "" });

  useEffect(() => {
    listRef.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const act = (item: Item | undefined, along: boolean) => {
    if (!item) return;
    if (move) {
      const to = item.kind === "new" ? { title: item.title } : item.kind === "ticket" ? a.taskForTicket(item.ticket) : item.info.task.id;
      if (a.moveSession(move.id, to)) onClose();
      return;
    }
    if (when) {
      const id =
        item.kind === "new"
          ? a.createTaskWithSession(item.title, when.start, when.end)
          : a.createSession(item.kind === "ticket" ? a.taskForTicket(item.ticket) : item.info.task.id, when.start, when.end);
      onClose();
      onAdded?.(id, when.start);
      return;
    }
    if (item.kind === "new") a.startNew(item.title, along);
    else if (item.kind === "ticket") a.startTicket(item.ticket, along);
    else a.continueTask(item.info.task.id, along);
    onClose();
  };
  // A ticket opens first, so you can see it's the right one; the rest act straight away.
  const choose = (item: Item | undefined, along: boolean) => {
    if (item?.kind === "ticket") setViewing({ ticket: item.ticket, along });
    else act(item, along);
  };
  const actionLabel = move ? "Move it here" : when ? "Add the time here" : alongside ? "▶ Start alongside" : "▶ Start";
  const title = move
    ? `Move ${timeOfDay(move.start)}–${move.end ? timeOfDay(move.end) : "now"} (${hm((move.end ?? now) - move.start)}) to…`
    : when
      ? "Add time"
      : alongside
        ? "Also working on…"
        : "Switch task";

  return (
    <Dialog title={title} onClose={onClose} className="switcher">
      {when && <SpanFields when={when} onChange={setWhen} />}
      <input
        className="search"
        autoFocus
        value={q}
        placeholder={`Search tasks, ${cwOn ? "tickets, " : ""}projects, ${m.groupBy ? `${plural(m.groupBy.label.toLowerCase())}, ` : ""}notes… or type a new task`}
        aria-label="Search tasks"
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          const along = alongside || e.shiftKey;
          if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, items.length - 1));
          else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
          else if (e.key === "Enter" && (e.ctrlKey || e.altKey || e.metaKey))
            act(query ? { kind: "new", title: query } : undefined, along);
          else if (e.key === "Enter") choose(items[sel], along);
          else return;
          e.preventDefault();
        }}
      />
      <ul className="results" ref={listRef} role="listbox">
        {items.map((item, i) => (
          <li key={item.kind === "new" ? "new" : item.kind === "ticket" ? `cw${item.ticket.id}` : item.info.task.id}>
            {item.kind === "ticket" && items[i - 1]?.kind !== "ticket" && (
              <div className="picker-section">{query ? "From ConnectWise" : "Your open tickets"}</div>
            )}
            <button
              className={i === sel ? "active" : ""}
              onMouseEnter={() => setSel(i)}
              onClick={(e) => choose(item, alongside || e.shiftKey)}
            >
              {item.kind === "new" ? (
                <span className="result-new">
                  {when || move ? "+" : "▶"} New task{item.title ? ": " : ""}
                  <strong>{item.title}</strong>
                </span>
              ) : item.kind === "ticket" ? (
                <TicketRow t={item.ticket} />
              ) : (
                <ResultRow info={item.info} now={now} running={runningIds.has(item.info.task.id)} />
              )}
            </button>
          </li>
        ))}
      </ul>
      {cwOn && (
        <div className="switcher-cw">
          <button className="btn subtle sm" onClick={() => setBrowsing(true)} title="Find a ticket by company, service or project">
            ⌕ Browse tickets by company…
          </button>
          {busy && <span className="muted small">Searching ConnectWise…</span>}
        </div>
      )}
      {browsing && <TicketPicker actionLabel={actionLabel} onPick={(ticket) => act({ kind: "ticket", ticket }, alongside)} onClose={() => setBrowsing(false)} />}
      {viewing && (
        <TicketView
          ticketId={viewing.ticket.id}
          primary={{ label: actionLabel, run: () => act({ kind: "ticket", ticket: viewing.ticket }, viewing.along) }}
          onClose={() => setViewing(null)}
        />
      )}
      <div className="hint muted small wide-only">
        {move ? (
          <>↑↓ move · Enter move it there · Ctrl+Enter new task · Esc cancel</>
        ) : when ? (
          <>↑↓ move · Enter add the time · Ctrl+Enter new task · Esc cancel</>
        ) : (
          <>
            ↑↓ move · Enter {alongside ? "start alongside" : "switch"}
            {alongside ? "" : " · Shift+Enter alongside"} · Ctrl+Enter new task · Esc close
          </>
        )}
      </div>
    </Dialog>
  );
}

/** The day, start and end of time being added. An end before the start means past midnight. */
function SpanFields({ when, onChange }: { when: { start: number; end: number }; onChange: (w: { start: number; end: number }) => void }) {
  const length = when.end - when.start;
  const setDay = (value: string) => {
    const [y, mo, d] = value.split("-").map(Number);
    if (!y || !mo || !d) return;
    const shift = startOfDay(new Date(y, mo - 1, d, 12).getTime()) - startOfDay(when.start);
    onChange({ start: when.start + shift, end: when.end + shift });
  };
  const setStart = (value: string) => {
    const t = at(startOfDay(when.start), value);
    if (t !== null) onChange({ start: t, end: t + length });
  };
  const setEnd = (value: string) => {
    let t = at(startOfDay(when.start), value);
    if (t === null) return;
    if (t <= when.start) t += 86_400_000;
    onChange({ ...when, end: t });
  };
  return (
    <div className="span-fields">
      <label>
        <span className="copy-label">Date</span>
        <input type="date" className="editor-input" value={dateValue(when.start)} onChange={(e) => setDay(e.target.value)} />
      </label>
      <label>
        <span className="copy-label">Start</span>
        <input type="time" className="editor-input" value={timeValue(when.start)} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        <span className="copy-label">End</span>
        <input type="time" className="editor-input" value={timeValue(when.end)} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <span className="muted small span-length">{hm(length)}</span>
    </div>
  );
}

function ResultRow({ info, now, running }: { info: TaskInfo; now: number; running: boolean }) {
  const { total } = taskTotals(info, now);
  const meta = [
    info.projectPath,
    ...info.fieldTexts,
    info.inbox ? "inbox" : whenLabel(info.lastTouched, now),
    total > 0 && hm(total),
    info.task.status === "done" && "done",
    running && "running",
  ].filter(Boolean);
  return (
    <span className="result">
      <span className="row-title">{info.title}</span>
      <span className="row-meta">{meta.join(" · ")}</span>
    </span>
  );
}
