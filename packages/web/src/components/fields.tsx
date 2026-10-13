import {
  companyKind,
  projectPath,
  searchCompanies,
  ticketNumber,
  type CompanyInfo,
  type FieldDef,
  type FieldValue,
  type Id,
  type ListItem,
  type Session,
  type Task,
} from "@sideshow/shared";
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { syncText, useCompanies } from "../companies";
import { RefreshIcon } from "./icons";
import { Spinner } from "./Spinner";
import { useA, useM } from "../model";

// Text fields bound to synced values. They keep a local draft so that
// updates arriving from another device never yank text out from under the cursor.

function useDraft(value: string, el: React.RefObject<HTMLElement | null>, resetKey?: unknown) {
  const [draft, setDraft] = useState(value);
  // When the field switches to a different record (e.g. a new session), reset during
  // render rather than in an effect. Otherwise a keystroke landing between the two
  // would append to the previous record's text.
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setDraft(value);
  }
  useEffect(() => {
    if (document.activeElement !== el.current) setDraft(value);
  }, [value, el]);
  return [draft, setDraft] as const;
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onValue: (v: string) => void;
  resetKey?: unknown;
};

export function DraftInput({ value, onValue, resetKey, ...rest }: InputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useDraft(value, ref, resetKey);
  return (
    <input
      {...rest}
      ref={ref}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onValue(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        rest.onKeyDown?.(e);
      }}
    />
  );
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onValue: (v: string) => void;
  resetKey?: unknown;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
};

export function DraftTextarea({ value, onValue, resetKey, textareaRef, ...rest }: TextareaProps) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? own;
  const [draft, setDraft] = useDraft(value, ref, resetKey);
  return (
    <textarea
      {...rest}
      ref={ref}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onValue(e.target.value);
      }}
    />
  );
}

type Option = {
  key: string;
  text: string;
  /** Shown instead of `text`, which stays the accessible name. */
  label?: ReactNode;
  /** A heading shown above the first option of each section. */
  section?: string;
  pick: () => void;
};

/**
 * A chip that opens a find-or-add list. `options(query)` gives the choices for what's
 * typed so far (lowercased, trimmed).
 */
export function ComboPicker({
  chip,
  chipTitle,
  set,
  placeholder,
  options: optionsFor,
  empty = "Type a name to add one",
  footer,
}: {
  chip: ReactNode;
  /** Tooltip for the chip. */
  chipTitle?: string;
  set: boolean;
  placeholder: string;
  options: (query: string, typed: string) => Option[];
  /** Shown when nothing matches. */
  empty?: string;
  /** Below the list (a "show duplicates" box). */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const options = optionsFor(q.trim().toLowerCase(), q.trim());

  const close = () => {
    setOpen(false);
    setQ("");
    setSel(0);
  };
  const choose = (i: number) => {
    options[i]?.pick();
    close();
  };

  if (!open) {
    return (
      <button type="button" className={`chip ${set ? "chip-set" : ""}`} title={chipTitle} onClick={() => setOpen(true)}>
        {chip}
      </button>
    );
  }
  return (
    <div
      className="picker"
      ref={box}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node)) close();
      }}
    >
      <input
        autoFocus
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, options.length - 1));
          else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
          else if (e.key === "Enter") choose(sel);
          else if (e.key === "Escape") close();
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      <ul role="listbox">
        {options.map((o, i) => (
          <li key={o.key}>
            {o.section && o.section !== options[i - 1]?.section && <div className="picker-section">{o.section}</div>}
            <button
              type="button"
              className={i === sel ? "active" : ""}
              aria-label={o.label ? o.text : undefined}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(i)}
            >
              {o.label ?? o.text}
            </button>
          </li>
        ))}
        {options.length === 0 && <li className="muted pad">{empty}</li>}
      </ul>
      {footer}
    </div>
  );
}

/** A green chain: this client is linked to a ConnectWise company. */
export function LinkedIcon({ title = "Linked to a ConnectWise company" }: { title?: string }) {
  return (
    <svg className="linked-icon" viewBox="0 0 16 16" width="14" height="14" role="img" aria-label={title}>
      <title>{title}</title>
      <path
        d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.4-2.4a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The CW company a list item is linked to, if any. */
export const linkedCompanyId = (item: ListItem | undefined): number | undefined => {
  const id = item?.ext?.cw?.companyId;
  return typeof id === "number" ? id : undefined;
};

/** "Lead · last ticket 2026-09", "older duplicate · Customer · last ticket 2024-06": what sets a company apart. */
export function companyNote(c: CompanyInfo): string {
  const notes: string[] = [];
  if (c.dupOf !== undefined) notes.push("older duplicate");
  const kind = companyKind(c);
  if (kind === "lead") notes.push(c.types.includes("Lead") ? "Lead" : "Prospect");
  else if (kind === "former") notes.push("Former client");
  else if (kind === "other") notes.push(c.types.join(", ") || "no type");
  notes.push(c.lastTicket ? `last ticket ${c.lastTicket.slice(0, 7)}` : "no tickets");
  return notes.join(" · ");
}

/** A CW company as a picker row: its name, and what sets it apart. */
export function CompanyLabel({ c, linkedTo }: { c: CompanyInfo; linkedTo?: string }) {
  return (
    <span className="company-option">
      <span>{c.name}</span>
      <span className="muted small">
        {companyNote(c)}
        {linkedTo ? ` · linked to ${linkedTo}` : ""}
      </span>
    </span>
  );
}

/** A list item's name, with the chain if it's linked to a CW company. */
export function ItemName({ item }: { item: ListItem }) {
  return (
    <span className="item-name">
      {item.name}
      {linkedCompanyId(item) !== undefined && <LinkedIcon />}
    </span>
  );
}

/**
 * The client field with ConnectWise: your clients first (a chain on the linked ones), then
 * CW companies not linked yet, without their older duplicates unless asked. Picking a company
 * links it to a client of the same name, or adds one.
 */
function ClientPicker({ def, value, onChange }: { def: FieldDef; value: Id | null; onChange: (id: Id | null) => void }) {
  const m = useM();
  const a = useA();
  const cw = useCompanies(true);
  const [dups, setDups] = useState(false);
  const items = [...(m.lists.get(def.list!) ?? [])].sort((x, y) => x.name.localeCompare(y.name));
  const linked = new Set(items.map(linkedCompanyId).filter((x) => x !== undefined));
  const current = value ? m.view.lists[value] : undefined;
  const label = def.label.toLowerCase();
  return (
    <ComboPicker
      chip={current ? <ItemName item={current} /> : `+ ${def.label}`}
      set={!!current}
      placeholder={`Find ${label}…`}
      empty={!cw.companies.length && (cw.busy || cw.syncing) ? "Loading ConnectWise companies…" : "No match"}
      options={(query, typed) => {
        const mine = items.filter((x) => x.name.toLowerCase().includes(query)).slice(0, query ? 6 : 8);
        const theirs = query ? searchCompanies(cw.companies, typed, { withDuplicates: dups, limit: 8 }).filter((c) => !linked.has(c.id)) : [];
        return [
          ...mine.map((x) => ({
            key: x.id,
            text: x.name,
            label: <ItemName item={x} />,
            section: query ? `Your ${label}s` : undefined,
            pick: () => onChange(x.id),
          })),
          ...theirs.map((c) => ({
            key: `cw${c.id}`,
            text: c.name,
            label: <CompanyLabel c={c} />,
            section: "From ConnectWise",
            pick: () => onChange(a.clientForCompany(def.list!, c)),
          })),
          ...(query && !items.some((x) => x.name.toLowerCase() === query)
            ? [{ key: "+", text: `Add “${typed}” (not in ConnectWise)`, pick: () => onChange(a.createListItem(def.list!, typed)) }]
            : []),
          ...(value ? [{ key: "-", text: `No ${label}`, pick: () => onChange(null) }] : []),
        ];
      }}
      footer={
        <>
          {syncText(cw) && (
            <p className="picker-footer muted small busy-line" role="status">
              <Spinner /> {syncText(cw)}
            </p>
          )}
          <label className="picker-footer muted small">
            <input type="checkbox" checked={dups} onChange={(e) => setDups(e.target.checked)} />
            Show older duplicates
          </label>
        </>
      }
    />
  );
}

/** Pick an item of a long list (clients), or type a new name to add one. */
function ListPicker({ def, value, onChange }: { def: FieldDef; value: Id | null; onChange: (id: Id | null) => void }) {
  const m = useM();
  if (m.config.cw && def.key === m.profile.connectwise?.clientField) return <ClientPicker def={def} value={value} onChange={onChange} />;
  return <PlainListPicker def={def} value={value} onChange={onChange} />;
}

function PlainListPicker({ def, value, onChange }: { def: FieldDef; value: Id | null; onChange: (id: Id | null) => void }) {
  const m = useM();
  const a = useA();
  const items = [...(m.lists.get(def.list!) ?? [])].sort((x, y) => x.name.localeCompare(y.name));
  const current = value ? m.view.lists[value] : undefined;
  const label = def.label.toLowerCase();
  return (
    <ComboPicker
      chip={current ? current.name : `+ ${def.label}`}
      set={!!current}
      placeholder={`Find or add ${label}…`}
      options={(query, typed) => [
        ...items
          .filter((x) => x.name.toLowerCase().includes(query))
          .slice(0, 8)
          .map((x) => ({ key: x.id, text: x.name, pick: () => onChange(x.id) })),
        ...(query && !items.some((x) => x.name.toLowerCase() === query)
          ? [{ key: "+", text: `Add “${typed}”`, pick: () => onChange(a.createListItem(def.list!, typed)) }]
          : []),
        ...(value ? [{ key: "-", text: `No ${label}`, pick: () => onChange(null) }] : []),
      ]}
    />
  );
}

/** A dropdown of fixed options (a choice field, or a short list such as work types). */
function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: { value: string; text: string }[];
  onChange: (v: string | null) => void;
}) {
  return (
    <select
      className={`select ${value ? "" : "unset"}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={label}
    >
      <option value="">{label}…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.text}
        </option>
      ))}
    </select>
  );
}

/** A choice field as a row of buttons, `B | NB | NC`; the full option names are the tooltips. */
function Segmented({ def, value, onChange }: { def: FieldDef; value: string | null; onChange: (v: string) => void }) {
  const options = def.options ?? [];
  return (
    <span className={`segmented ${value ? "" : "unset"}`} role="group" aria-label={def.label}>
      {options.map((o, i) => (
        <button
          key={o}
          type="button"
          className={`seg ${value === o ? "seg-on" : ""}`}
          aria-pressed={value === o}
          title={`${def.label}: ${o}`}
          aria-label={o}
          onClick={() => value !== o && onChange(o)}
        >
          {def.short?.[i] ?? o}
        </button>
      ))}
    </span>
  );
}

/** Edit one profile field, in whatever form its type calls for. */
export function FieldInput({
  def,
  value,
  onChange,
  resetKey,
}: {
  def: FieldDef;
  value: FieldValue | undefined;
  onChange: (v: FieldValue | null) => void;
  /** Which record it edits, so a text draft resets when that changes. */
  resetKey?: unknown;
}) {
  const m = useM();
  switch (def.type) {
    case "list":
      if (def.input === "search") return <ListPicker def={def} value={value ? String(value) : null} onChange={onChange} />;
      return (
        <SelectField
          label={def.label}
          value={value ? String(value) : null}
          options={(m.lists.get(def.list!) ?? []).map((x) => ({ value: x.id, text: x.name }))}
          onChange={onChange}
        />
      );
    case "choice":
      // An unset choice with a default ("Internal") shows the default as chosen.
      value ??= def.default;
      if (def.input === "segmented") return <Segmented def={def} value={value ? String(value) : null} onChange={onChange} />;
      return (
        <SelectField
          label={def.label}
          value={value ? String(value) : null}
          options={(def.options ?? []).map((o) => ({ value: o, text: o }))}
          onChange={onChange}
        />
      );
    case "bool":
      return (
        <button type="button" className={`chip ${value ? "chip-set" : ""}`} aria-pressed={!!value} onClick={() => onChange(!value)}>
          {value ? "✓ " : ""}
          {def.label}
        </button>
      );
    case "text":
      return (
        <DraftInput
          className="ref-input"
          value={value ? String(value) : ""}
          placeholder={def.label}
          aria-label={def.label}
          resetKey={resetKey}
          onValue={(v) => onChange(v)}
        />
      );
  }
}

/** All of the profile's task fields for one task. */
export function TaskFieldInputs({ task }: { task: Task }) {
  const m = useM();
  const a = useA();
  return (
    <>
      {m.profile.fields
        .filter((d) => d.on === "task")
        .map((d) => (
          <FieldInput
            key={d.key}
            def={d}
            value={task.fields[d.key]}
            resetKey={task.id}
            onChange={(v) => a.setTaskField(task.id, d.key, v)}
          />
        ))}
    </>
  );
}

/** All of the profile's session fields for one session. */
export function SessionFieldInputs({ session }: { session: Session }) {
  const m = useM();
  const a = useA();
  return (
    <>
      {m.profile.fields
        .filter((d) => d.on === "session")
        .map((d) => (
          <FieldInput
            key={d.key}
            def={d}
            value={session.fields[d.key]}
            resetKey={session.id}
            onChange={(v) => a.setSessionField(session.id, d.key, v)}
          />
        ))}
    </>
  );
}

/**
 * Pick a project, or type a name to add a new top-level one. `exclude` leaves out a
 * project and everything inside it (choosing where a project itself goes).
 */
export function ProjectPicker({
  value,
  onChange,
  none = "No project",
  empty = "+ Project",
  exclude,
}: {
  value: Id | null;
  onChange: (id: Id | null) => void;
  none?: string;
  /** The chip when no project is chosen. */
  empty?: string;
  exclude?: Id;
}) {
  const m = useM();
  const a = useA();
  const current = m.projects.find((p) => p.project.id === value);
  const choices = exclude
    ? m.projects.filter((p) => !projectPath(m.view, p.project.id).some((x) => x.id === exclude))
    : m.projects;
  return (
    <ComboPicker
      chip={current ? current.project.title || "Untitled project" : empty}
      chipTitle={current?.path}
      set={!!current}
      placeholder="Find or add project…"
      options={(query, typed) => [
        ...choices
          .filter((p) => p.path.toLowerCase().includes(query))
          .slice(0, 10)
          .map((p) => ({ key: p.project.id, text: p.path, pick: () => onChange(p.project.id) })),
        ...(query && !m.projects.some((p) => p.project.title.toLowerCase() === query)
          ? [{ key: "+", text: `Add project “${typed}”`, pick: () => onChange(a.createProject(typed, null)) }]
          : []),
        ...(value ? [{ key: "-", text: none, pick: () => onChange(null) }] : []),
      ]}
    />
  );
}

/** The CW web page of a task's ticket, if CW is on and the task has a ticket number. */
export function ticketUrl(m: { config: { cwTicketUrl?: string | null }; profile: { connectwise?: { ticketField: string } } }, task: Task): string | null {
  const field = m.profile.connectwise?.ticketField;
  const n = field ? ticketNumber(String(task.fields[field] ?? "")) : "";
  return n && m.config.cwTicketUrl ? m.config.cwTicketUrl.replace("{id}", n) : null;
}

/**
 * The CW ticket behind a task's ticket field: summary and company, looked up once the number
 * has settled (and again with ↻). Shows nothing without a ticket number or without CW.
 */
export function TicketInfo({
  task,
  compact = false,
  onRefresh,
}: {
  task: Task;
  compact?: boolean;
  /** Also run on ↻ (the Day page checks its pushed entries). */
  onRefresh?: () => void;
}) {
  const m = useM();
  const a = useA();
  const field = m.profile.connectwise?.ticketField;
  const on = !!m.config.cw && !!field;
  const n = field ? ticketNumber(String(task.fields[field] ?? "")) : "";
  const info = task.refInfo?.ref === n ? task.refInfo : null;
  // The last lookup this field ran, so a number that wasn't found isn't retried on every render.
  const [tried, setTried] = useState<{ n: string; busy: boolean; error: string | null } | null>(null);

  const lookup = async () => {
    setTried({ n, busy: true, error: null });
    const error = await a.lookupTicket(task.id);
    setTried({ n, busy: false, error });
  };

  useEffect(() => {
    if (!on || !n || info || tried?.n === n) return;
    const id = setTimeout(() => void lookup(), 800);
    return () => clearTimeout(id);
  }, [on, n, info, tried?.n]);

  if (!on || !n) return null;
  const current = tried?.n === n ? tried : null;
  if (current?.busy) return <p className="ticket muted small">Looking up #{n}…</p>;
  if (current?.error) {
    return (
      <p className="ticket small">
        <span className="warn">{current.error}</span>
        <button className="btn subtle ticket-refresh" onClick={() => void lookup()}>
          Retry
        </button>
      </p>
    );
  }
  if (!info) return null;
  // The CW company next to the task's client: hidden when they match (the Client chip says it),
  // offered as the client when none is set, and pointed out when they differ.
  const clientKey = m.profile.connectwise?.clientField;
  const clientDef = m.profile.fields.find((f) => f.key === clientKey);
  const clientId = clientKey ? task.fields[clientKey] : undefined;
  const clientItem = clientId ? m.view.lists[String(clientId)] : undefined;
  const clientName = clientItem?.name;
  const same = (x: string | undefined) => !!x && x.trim().toLowerCase() === info.company.trim().toLowerCase();
  const sameClient = same(clientName) || (!!info.companyId && linkedCompanyId(clientItem) === info.companyId);
  const setClient = () => {
    if (!clientDef?.list || !clientKey) return;
    if (info.companyId) {
      a.setTaskField(task.id, clientKey, a.clientForCompany(clientDef.list, { id: info.companyId, name: info.company }));
      return;
    }
    const existing = (m.lists.get(clientDef.list) ?? []).find((x) => same(x.name));
    a.setTaskField(task.id, clientKey, existing ? existing.id : a.createListItem(clientDef.list, info.company));
  };
  const company =
    !info.company || sameClient ? null : clientName ? (
      <span className="muted" title={`The ticket's company in ConnectWise differs from this task's ${clientDef?.label.toLowerCase() ?? "client"}`}>
        CW: {info.company}
      </span>
    ) : (
      <>
        <span className="muted">{info.company}</span>
        {clientDef?.list && (
          <button className="btn subtle ticket-set-client" onClick={setClient} title={`Use the ticket's company as this task's ${clientDef.label.toLowerCase()}`}>
            Set as {clientDef.label.toLowerCase()}
          </button>
        )}
      </>
    );
  // Next to the task's title (the Day page), the summary would say the same thing again.
  const showSummary = !compact || info.summary.trim() !== task.title.trim();
  return (
    <p className={`ticket small ${compact ? "compact" : ""}`}>
      <span className="ticket-text">
        {!showSummary ? null : ticketUrl(m, task) ? (
          <a className="ticket-summary ticket-link" href={ticketUrl(m, task)!} target="_blank" rel="noreferrer" title="Open the ticket in ConnectWise">
            {info.summary} ↗
          </a>
        ) : (
          <span className="ticket-summary">{info.summary}</span>
        )}
        {(company || info.closed) && (
          <span className="ticket-company">
            {company}
            {info.closed && <span className="warn">closed</span>}
          </span>
        )}
      </span>
      <button
        className="btn subtle ticket-refresh"
        onClick={() => {
          void lookup();
          onRefresh?.();
        }}
        title="Refresh from ConnectWise"
        aria-label="Refresh ticket from ConnectWise"
      >
        <RefreshIcon size={compact ? 15 : 17} />
      </button>
    </p>
  );
}

/** A one-line "type a name, press Add" form. */
export function InlineAdd({
  value,
  onValue,
  placeholder,
  onAdd,
}: {
  value: string;
  onValue: (v: string) => void;
  placeholder: string;
  onAdd: (title: string) => void;
}) {
  return (
    <form
      className="row-actions inline-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onAdd(value.trim());
        onValue("");
      }}
    >
      <input
        className="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        autoCapitalize="sentences"
        onChange={(e) => onValue(e.target.value)}
      />
      <button type="submit" className="btn" disabled={!value.trim()}>
        Add
      </button>
    </form>
  );
}
