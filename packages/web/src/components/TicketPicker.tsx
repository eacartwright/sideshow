import { searchCompanies } from "@sideshow/shared";
import { useEffect, useRef, useState } from "react";
import { useCompanies } from "../companies";
import { useM } from "../model";
import { searchTickets, type TicketHit, type TicketResults, type TicketSearch } from "../tickets";
import { Dialog } from "./Dialog";
import { CompanyLabel, ComboPicker, linkedCompanyId } from "./fields";
import { Spinner } from "./Spinner";
import { TicketView } from "./TicketView";

// Find a ConnectWise ticket without leaving the app (DESIGN.md §10): what used to be "look up the
// company, Service or Project, scroll, copy the number". Service and project tickets in one list;
// narrowing by company, by what's typed, by yours. Tapping one opens it (TicketView), so you can see
// it's the right one; nothing happens until you say so there. Searched live: nothing is imported
// until one is used, and then only that one.

/** Ask CW as the search changes, a moment after typing stops. Older answers are dropped. */
export function useTicketSearch(search: TicketSearch | null, delayMs = 300) {
  const [state, setState] = useState<{ results: TicketResults | null; busy: boolean; error: string | null }>({ results: null, busy: !!search, error: null });
  const seq = useRef(0);
  const key = search ? JSON.stringify(search) : null;
  useEffect(() => {
    const mine = ++seq.current;
    if (!search) {
      setState({ results: null, busy: false, error: null });
      return;
    }
    setState((s) => ({ ...s, busy: true, error: null }));
    const id = setTimeout(() => {
      searchTickets(search).then(
        (results) => {
          if (mine === seq.current) setState({ results, busy: false, error: null });
        },
        () => {
          if (mine === seq.current) setState({ results: null, busy: false, error: "Couldn't search ConnectWise: check the connection and try again" });
        },
      );
    }, delayMs);
    return () => clearTimeout(id);
  }, [key]);
  return state;
}

/** One result: its number and summary, then where it belongs. */
export function TicketRow({ t }: { t: TicketHit }) {
  const where = t.kind === "project" ? [t.company, t.project, t.phase] : [t.company, t.board];
  return (
    <span className="ticket-hit">
      <span className="ticket-hit-title">
        <span className="ticket-hit-num">#{t.id}</span> {t.summary}
      </span>
      <span className="row-meta">
        {[...where, t.status].filter(Boolean).join(" · ")}
        {t.mine && <span className="ticket-hit-mine"> · yours</span>}
        {t.closed && <span className="warn"> · closed</span>}
      </span>
    </span>
  );
}

export function TicketPicker({
  title = "Find a ticket",
  actionLabel = "Use this ticket",
  companyId: startCompany,
  companyName: startName,
  onPick,
  onClose,
}: {
  title?: string;
  /** What the opened ticket's main button says. */
  actionLabel?: string;
  /** Start narrowed to this company (the task's). */
  companyId?: number;
  companyName?: string;
  onPick: (t: TicketHit) => void;
  onClose: () => void;
}) {
  const m = useM();
  const cw = useCompanies(true);
  const [q, setQ] = useState("");
  const [company, setCompany] = useState<{ id: number; name: string } | null>(startCompany ? { id: startCompany, name: startName ?? "" } : null);
  // A company's tickets are usually someone else's too; with no company, yours are the useful list.
  const [mine, setMine] = useState(!startCompany);
  const [closed, setClosed] = useState(false);
  const [viewing, setViewing] = useState<TicketHit | null>(null);
  const canMine = !!m.config.cwPush;
  const { results, busy, error } = useTicketSearch({ q, companyId: company?.id ?? null, mine: mine && canMine, closed });
  const tickets = results?.tickets ?? [];
  const service = tickets.filter((t) => t.kind === "service");
  const project = [...tickets.filter((t) => t.kind === "project")].sort((a, b) => (a.project ?? "").localeCompare(b.project ?? "") || b.id - a.id);

  const row = (t: TicketHit) => (
    <li key={t.id}>
      <button onClick={() => setViewing(t)}>
        <TicketRow t={t} />
      </button>
    </li>
  );

  return (
    <Dialog title={title} onClose={onClose} className="switcher ticket-picker">
      <input className="search" autoFocus value={q} placeholder="Ticket number, or words from it…" aria-label="Search tickets" onChange={(e) => setQ(e.target.value)} />
      <div className="ticket-filters">
        <ComboPicker
          chip={company ? company.name : "Company: All"}
          chipTitle={company ? `Only ${company.name}` : "Narrow to one company"}
          set={!!company}
          onClear={
            company
              ? () => {
                  setCompany(null);
                  setMine(true);
                }
              : undefined
          }
          clearLabel="All companies"
          placeholder="Find company…"
          empty={cw.companies.length ? "No match" : "Loading ConnectWise companies…"}
          options={(query, typed) =>
            query
              ? searchCompanies(cw.companies, typed, { limit: 10 }).map((c) => ({
                  key: `cw${c.id}`,
                  text: c.name,
                  label: <CompanyLabel c={c} />,
                  pick: () => {
                    setCompany({ id: c.id, name: c.name });
                    setMine(false);
                  },
                }))
              : recentCompanies(m).map((c) => ({
                  key: `r${c.id}`,
                  text: c.name,
                  section: "Recent",
                  pick: () => {
                    setCompany(c);
                    setMine(false);
                  },
                }))
          }
        />
        {canMine && (
          <span className="segmented" role="group" aria-label="Whose tickets">
            <button type="button" className={`seg ${mine ? "seg-on" : ""}`} aria-pressed={mine} onClick={() => setMine(true)}>
              Mine
            </button>
            <button type="button" className={`seg ${mine ? "" : "seg-on"}`} aria-pressed={!mine} onClick={() => setMine(false)}>
              Everyone's
            </button>
          </span>
        )}
        <label className="ticket-closed muted small">
          <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Closed too
        </label>
      </div>
      <ul className="results" role="listbox" aria-busy={busy}>
        {service.length > 0 && project.length > 0 && <li className="picker-section">Service</li>}
        {service.map(row)}
        {project.length > 0 && <li className="picker-section">Project</li>}
        {project.map(row)}
      </ul>
      <div className="hint muted small busy-line" role="status">
        {busy ? (
          <>
            <Spinner /> Searching ConnectWise…
          </>
        ) : error ? (
          <span className="warn">{error}</span>
        ) : results?.note ? (
          <span className="warn">{results.note}</span>
        ) : tickets.length === 0 ? (
          mine && canMine ? "None of yours match. Try Everyone's." : "No tickets match."
        ) : (
          `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}, yours first`
        )}
      </div>
      {viewing && (
        <TicketView
          ticketId={viewing.id}
          primary={{
            label: actionLabel,
            run: () => {
              onPick(viewing);
              onClose();
            },
          }}
          onClose={() => setViewing(null)}
        />
      )}
    </Dialog>
  );
}

/** The CW companies on recent tasks, most recent first. */
function recentCompanies(m: ReturnType<typeof useM>) {
  const key = m.profile.connectwise?.clientField;
  const out: { id: number; name: string }[] = [];
  if (!key) return out;
  for (const t of m.recent) {
    const item = m.view.lists[String(t.task.fields[key] ?? "")];
    const id = linkedCompanyId(item);
    if (item && id !== undefined && !out.some((c) => c.id === id)) out.push({ id, name: item.name });
    if (out.length >= 8) break;
  }
  return out;
}
