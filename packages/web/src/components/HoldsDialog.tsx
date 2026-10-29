import { useEffect, useState } from "react";
import { timeOfDay } from "../format";
import {
  AHEAD_WEEKS,
  dateLabel,
  dayName,
  daysLabel,
  deleteHold,
  loadHolds,
  reminderLabel,
  REMINDERS,
  saveHold,
  skipHoldDay,
  spanLabel,
  syncHolds,
  today,
  WEEK,
  type Hold,
  type HoldDay,
  type HoldRule,
} from "../holds";
import { showToast } from "../toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { Spinner } from "./Spinner";

// Holds (the header's Holds button): schedule holds, blocks that repeat on the CW calendar
// (DESIGN.md §10). Each one with its days to come, any of which can be skipped (PTO) or made
// again; and a form, over the list, to add or change one.

const NAME_MAX = 100;

const STATE: Record<HoldDay["state"], string> = {
  made: "✓ In ConnectWise",
  waiting: "Not made yet",
  skipped: "Skipped",
  gone: "Deleted in ConnectWise",
};

const entries = (n: number) => (n === 1 ? "1 entry" : `${n} entries`);

export function HoldsDialog({ onClose }: { onClose: () => void }) {
  const [holds, setHolds] = useState<Hold[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The form: a new hold, or the one being changed. */
  const [form, setForm] = useState<{ hold: Hold | null } | null>(null);
  const [deleting, setDeleting] = useState<Hold | null>(null);
  /** What's waiting on the server: a hold's id, or `<id>:<date>` for one day. */
  const [busy, setBusy] = useState<string | null>(null);

  const take = (a: { holds?: Hold[]; error?: string }) => {
    if (a.holds) setHolds(a.holds);
    setError(a.error ?? null);
  };
  useEffect(() => {
    void loadHolds().then(take);
  }, []);

  const work = async (key: string, fn: () => Promise<{ holds?: Hold[]; error?: string }>) => {
    setBusy(key);
    take(await fn());
    setBusy(null);
  };

  return (
    <Dialog
      title="Schedule holds"
      onClose={onClose}
      className="holds"
      actions={
        holds && (
          <button className="btn" onClick={() => setForm({ hold: null })}>
            + New hold
          </button>
        )
      }
    >
      <p className="muted small holds-intro">
        Blocks that repeat on your ConnectWise calendar. sideshow keeps the next {AHEAD_WEEKS} weeks of each one there, a day at a
        time. Changing or deleting a hold changes the entries that haven't started yet; earlier ones stay.
      </p>
      {error && (
        <p className="warn small" role="alert">
          {error}
        </p>
      )}
      {!holds && !error && (
        <p className="muted small busy-line" role="status">
          <Spinner /> Loading…
        </p>
      )}
      {holds?.length === 0 && (
        <div className="stack holds-empty">
          <p className="muted">No holds yet: an end-of-day block for time entries, say.</p>
          <button className="btn primary" onClick={() => setForm({ hold: null })}>
            + New hold
          </button>
        </div>
      )}
      {holds?.map((h) => (
        <HoldCard
          key={h.id}
          hold={h}
          busy={busy}
          onEdit={() => setForm({ hold: h })}
          onDelete={() => setDeleting(h)}
          onRetry={() => void work(h.id, () => (h.removed ? deleteHold(h.id) : syncHolds()))}
          onSkip={(d, skip) => void work(`${h.id}:${d.date}`, () => skipHoldDay(h.id, d.date, skip))}
        />
      ))}

      {form && (
        <HoldForm
          hold={form.hold}
          onCancel={() => setForm(null)}
          onSaved={(list, id) => {
            setHolds(list);
            setError(null);
            setForm(null);
            const saved = list.find((h) => h.id === id);
            if (saved && !saved.error) showToast(`Saved: ${entries(saved.upcoming.filter((d) => d.state === "made").length)} in ConnectWise`);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete hold"
          confirm="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const h = deleting;
            setDeleting(null);
            void work(h.id, async () => {
              const a = await deleteHold(h.id);
              if (a.holds && !a.holds.some((x) => x.id === h.id)) showToast(`Deleted “${h.name}”`);
              return a;
            });
          }}
        >
          <p>
            Delete <strong>{deleting.name}</strong>? Its {entries(upcomingMade(deleting).length)} still to come{" "}
            {upcomingMade(deleting).length === 1 ? "is" : "are"} removed from your ConnectWise calendar. Earlier ones stay.
          </p>
        </ConfirmDialog>
      )}
    </Dialog>
  );
}

/** Its entries in CW that haven't started. */
const upcomingMade = (h: Hold, now = Date.now()) => h.upcoming.filter((d) => d.state === "made" && d.start > now);

function HoldCard({
  hold: h,
  busy,
  onEdit,
  onDelete,
  onRetry,
  onSkip,
}: {
  hold: Hold;
  busy: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onSkip: (d: HoldDay, skip: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const made = h.upcoming.filter((d) => d.state === "made").length;
  const waiting = h.upcoming.filter((d) => d.state === "waiting").length;
  const off = h.upcoming.filter((d) => d.state === "skipped" || d.state === "gone").length;
  const ended = !!h.until && h.until < today();
  const range = ended
    ? `Ended ${dateLabel(h.until!)}`
    : h.until
      ? `${dateLabel(h.from)} to ${dateLabel(h.until)}`
      : `From ${dateLabel(h.from)}, no end date`;
  const working = busy === h.id;

  return (
    <section className={`hold ${h.removed ? "hold-removed" : ""}`} aria-label={h.name}>
      <div className="hold-head">
        <strong className="hold-name">{h.name}</strong>
        {!h.removed && (
          <>
            <button className="btn subtle" onClick={onEdit} disabled={!!busy}>
              Edit
            </button>
            <button className="btn subtle" onClick={onDelete} disabled={!!busy}>
              Delete
            </button>
          </>
        )}
      </div>
      <p>
        {daysLabel(h.days)} · {spanLabel(h.start, h.end)} · <span className="muted">{reminderLabel(h.reminder)}</span>
      </p>
      <p className="muted small">{range}</p>
      {h.removed ? (
        <p className="warn small">
          Being deleted: {entries(upcomingMade(h, now).length)} still in ConnectWise. {h.error}
        </p>
      ) : (
        h.error && (
          <p className="warn small">
            {waiting ? `${waiting === 1 ? "1 day" : `${waiting} days`} not made yet` : "Not up to date in ConnectWise"}: {h.error}. It tries again every hour.
          </p>
        )
      )}
      {(h.removed || h.error) && (
        <span className="row-actions">
          <button className="btn busy-line" onClick={onRetry} disabled={!!busy}>
            {working && <Spinner />} Try again
          </button>
        </span>
      )}
      {!h.removed && h.upcoming.length > 0 && (
        <button className="btn subtle hold-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span aria-hidden>{open ? "▾" : "▸"}</span> Next {AHEAD_WEEKS} weeks: {entries(made)} in ConnectWise
          {off ? `, ${off} skipped` : ""}
        </button>
      )}
      {!h.removed && !ended && !h.upcoming.length && <p className="muted small">Nothing in the next {AHEAD_WEEKS} weeks.</p>}
      {open && !h.removed && (
        <ul className="hold-days">
          {h.upcoming.map((d) => {
            const started = d.start <= now;
            const key = `${h.id}:${d.date}`;
            const isOff = d.state === "skipped" || d.state === "gone";
            return (
              <li key={d.date} className={`hold-day ${isOff ? "off" : ""}`}>
                <span className="hold-day-date">{dateLabel(d.date)}</span>
                <span className="hold-day-time">{timeOfDay(d.start)}</span>
                <span className={`hold-day-state small ${d.state}`}>{started && d.state === "made" ? "Started" : STATE[d.state]}</span>
                {!started && (
                  <button className="btn subtle busy-line" disabled={!!busy} onClick={() => onSkip(d, !isOff)}>
                    {busy === key && <Spinner />}
                    {isOff ? "Restore" : "Skip"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HoldForm({ hold, onCancel, onSaved }: { hold: Hold | null; onCancel: () => void; onSaved: (holds: Hold[], id: string) => void }) {
  const [rule, setRule] = useState<HoldRule>(() =>
    hold
      ? { name: hold.name, days: hold.days, start: hold.start, end: hold.end, from: hold.from, until: hold.until, reminder: hold.reminder, timeZone: hold.timeZone }
      : {
          name: "",
          days: [1, 2, 3, 4, 5],
          start: "16:00",
          end: "17:00",
          from: today(),
          until: null,
          reminder: 15,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<HoldRule>) => {
    setRule({ ...rule, ...patch });
    setError(null);
  };
  const toggleDay = (d: number) => set({ days: rule.days.includes(d) ? rule.days.filter((x) => x !== d) : [...rule.days, d].sort((a, b) => a - b) });

  // An empty description only keeps Save off; the rest is said.
  const problem = !rule.days.length
    ? "Pick at least one day."
    : !rule.start || !rule.end
      ? "Start and end times are needed."
      : rule.end <= rule.start
        ? "The end has to be after the start."
        : !rule.from
          ? "A start date is needed."
          : rule.until && rule.until < rule.from
            ? "The end date has to be on or after the start date."
            : null;

  const save = async () => {
    if (problem || !rule.name.trim()) return;
    setBusy(true);
    const a = await saveHold(hold?.id ?? null, { ...rule, name: rule.name.trim() });
    setBusy(false);
    if (!a.holds) return setError(a.error ?? "That didn't work.");
    onSaved(a.holds, hold?.id ?? a.id ?? "");
  };

  return (
    <Dialog title={hold ? "Edit hold" : "New hold"} onClose={onCancel} className="hold-form">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span className="field-label">Description</span>
          <input
            className="editor-input"
            value={rule.name}
            maxLength={NAME_MAX}
            placeholder="End of day time entries"
            onChange={(e) => set({ name: e.target.value })}
            autoFocus
          />
        </label>

        <div className="field">
          <span className="field-label" id="hold-days-label">
            Days
          </span>
          <span className="segmented hold-week" role="group" aria-labelledby="hold-days-label">
            {WEEK.map((d) => (
              <button
                key={d}
                type="button"
                className={`seg ${rule.days.includes(d) ? "seg-on" : ""}`}
                aria-pressed={rule.days.includes(d)}
                onClick={() => toggleDay(d)}
              >
                {dayName(d)}
              </button>
            ))}
          </span>
        </div>

        <div className="hold-grid">
          <label className="field">
            <span className="field-label">From</span>
            <input type="time" className="editor-input" value={rule.start} onChange={(e) => set({ start: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">To</span>
            <input type="time" className="editor-input" value={rule.end} onChange={(e) => set({ end: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Reminder</span>
            <select
              className="select editor-input"
              value={rule.reminder ?? ""}
              onChange={(e) => set({ reminder: e.target.value === "" ? null : Number(e.target.value) })}
            >
              {REMINDERS.map((m) => (
                <option key={m ?? "none"} value={m ?? ""}>
                  {m == null ? "None" : `${m} minutes`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="hold-grid">
          <label className="field">
            <span className="field-label">Starts</span>
            <input type="date" className="editor-input" value={rule.from} onChange={(e) => set({ from: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Ends (optional)</span>
            <input type="date" className="editor-input" value={rule.until ?? ""} min={rule.from} onChange={(e) => set({ until: e.target.value || null })} />
          </label>
        </div>

        <p className="muted small">
          In ConnectWise: a Schedule Hold on your calendar, In-house, Firm, no company or ticket.{" "}
          {hold ? "Changes go to the entries that haven't started yet." : `The next ${AHEAD_WEEKS} weeks are made now; later days as they come.`}
        </p>
        {problem && <p className="warn small">{problem}</p>}
        {error && (
          <p className="warn small" role="alert">
            {error}
          </p>
        )}

        <div className="row-actions">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary busy-line" disabled={busy || !!problem || !rule.name.trim()}>
            {busy && <Spinner />}
            {busy ? "Saving to ConnectWise…" : hold ? "Save" : "Create hold"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
