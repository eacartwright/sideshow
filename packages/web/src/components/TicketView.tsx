import { useEffect, useState } from "react";
import { withoutPictures } from "../markdown";
import { useM } from "../model";
import { fetchTicketView, type TicketActivity, type TicketPage } from "../tickets";
import { Dialog } from "./Dialog";
import { NoteView } from "./NoteView";
import { Spinner } from "./Spinner";

// A ConnectWise ticket, read-only, inside the app (DESIGN.md §10): what's going on with it before
// you start on it. Finding a ticket opens this rather than starting anything; `primary` is what
// happens if it's the right one (Start, Use this ticket, Add time here…). Read live each time.

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" });
};

/** Pictures in CW's notes aren't ours, and may be a client's email's: links, not loaded by themselves. */
const CwNote = ({ text }: { text: string }) => <NoteView markdown={withoutPictures(text)} />;

type Filter = "all" | "note" | "time";

export function TicketView({
  ticketId,
  primary,
  onClose,
}: {
  ticketId: number;
  /** What the main button does; none when you're only looking. */
  primary?: { label: string; run: () => void };
  onClose: () => void;
}) {
  const m = useM();
  const [page, setPage] = useState<TicketPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setError(null);
    fetchTicketView(ticketId).then(
      (p) => {
        if (current) setPage(p);
      },
      (err: Error) => {
        if (current) setError(err.message === "404" ? `No ticket #${ticketId}` : "Couldn't read this ticket from ConnectWise");
      },
    );
    return () => {
      current = false;
    };
  }, [ticketId, attempt]);

  const url = m.config.cwTicketUrl?.replace("{id}", String(ticketId));
  const activity = page?.activity ?? [];
  const notes = activity.filter((a) => a.kind === "note").length;
  const times = activity.length - notes;
  const shown = filter === "all" ? activity : activity.filter((a) => a.kind === filter);

  return (
    <Dialog
      title={`Ticket #${ticketId}`}
      onClose={onClose}
      className="ticket-view"
      actions={
        url && (
          <a className="btn subtle" href={url} target="_blank" rel="noreferrer" title="Open this ticket in ConnectWise">
            ↗ Open in CW
          </a>
        )
      }
    >
      {error ? (
        <p className="warn">
          {error}{" "}
          <button className="btn subtle sm" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      ) : !page ? (
        <p className="muted busy-line" role="status">
          <Spinner /> Reading the ticket from ConnectWise…
        </p>
      ) : (
        <>
          <div className="ticket-view-head">
            <h3>{page.summary}</h3>
            <p className="muted">
              {[page.company, page.status, page.board].filter(Boolean).join(" · ")}
              {page.closed && <span className="warn"> · closed</span>}
            </p>
          </div>
          {page.note && <p className="warn small">{page.note}</p>}

          <details className="ticket-details">
            <summary>Details</summary>
            <dl>
              <Row label="Project" value={[page.project, page.phase].filter(Boolean).join(" › ")} />
              <Row label="Site" value={page.site} />
              {page.contact && (
                <div>
                  <dt>Contact</dt>
                  <dd>
                    {page.contact.name}
                    {page.contact.phone && (
                      <>
                        {" · "}
                        <a href={`tel:${page.contact.phone}`}>{page.contact.phone}</a>
                      </>
                    )}
                    {page.contact.email && (
                      <>
                        {" · "}
                        <a href={`mailto:${page.contact.email}`}>{page.contact.email}</a>
                      </>
                    )}
                  </dd>
                </div>
              )}
              <Row label="Priority" value={page.priority} />
              <Row label="Type" value={page.type} />
              <Row label="Owner" value={page.owner} />
              <Row label="Assigned" value={page.resources.join(", ")} />
              <Row label="Entered" value={page.enteredAt && `${when(page.enteredAt)}${page.enteredBy ? ` by ${page.enteredBy}` : ""}`} />
              <Row label="Updated" value={page.updatedAt && `${when(page.updatedAt)}${page.updatedBy ? ` by ${page.updatedBy}` : ""}`} />
              <Row label="Hours" value={page.hours !== undefined ? page.hours.toFixed(2) : undefined} />
            </dl>
          </details>

          {page.description && (
            <section className="ticket-description">
              <h4>Description</h4>
              <CwNote text={page.description} />
            </section>
          )}

          <section className="ticket-activity">
            <div className="ticket-activity-head">
              <h4>Activity</h4>
              {notes > 0 && times > 0 && (
                <span className="segmented" role="group" aria-label="Show">
                  {(
                    [
                      ["all", `All ${activity.length}`],
                      ["note", `Notes ${notes}`],
                      ["time", `Time ${times}`],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={value} type="button" className={`seg ${filter === value ? "seg-on" : ""}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                      {label}
                    </button>
                  ))}
                </span>
              )}
            </div>
            {shown.length === 0 ? <p className="muted small">No notes or time on this ticket yet.</p> : <ul>{shown.map((a) => <Item key={a.id} a={a} />)}</ul>}
          </section>
        </>
      )}
      {primary && (
        <div className="ticket-view-actions">
          <button className="btn subtle" onClick={onClose}>
            Back
          </button>
          <button className="btn go" autoFocus disabled={!page && !error} onClick={primary.run}>
            {primary.label}
          </button>
        </div>
      )}
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Item({ a }: { a: TicketActivity }) {
  return (
    <li className={`ticket-item ${a.where.includes("Internal") && !a.where.includes("Discussion") ? "internal" : ""}`}>
      <div className="ticket-item-head">
        <strong>{a.who || "Someone"}</strong>
        <span className="muted small">{when(a.at)}</span>
        <span className="spacer" />
        {a.kind === "time" && (
          <span className="ticket-tag time">
            {a.hours !== undefined ? `${a.hours.toFixed(2)} h` : "Time"}
            {a.workType ? ` · ${a.workType}` : ""}
          </span>
        )}
        {a.where.map((w) => (
          <span key={w} className="ticket-tag">
            {w}
          </span>
        ))}
      </div>
      {a.text.trim() ? <CwNote text={a.text} /> : <p className="muted small">No notes</p>}
      {a.internal && (
        <div className="ticket-internal">
          <span className="muted small">Internal notes</span>
          <CwNote text={a.internal} />
        </div>
      )}
    </li>
  );
}
