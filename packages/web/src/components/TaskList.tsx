import { projectPath, startOfDay, type FieldDef, type Id, type ListItem } from "@sideshow/shared";
import { useState } from "react";
import { hm, whenLabel } from "../format";
import { taskTotals, useA, useM, useNow, type TaskInfo } from "../model";
import { addDays, DayNav } from "./DayNav";
import { ComboPicker } from "./fields";
import { wsKey } from "../workspace";
import { ProjectList } from "./ProjectList";

export type View = "recent" | "day" | "inbox" | "done" | "projects";

export function TaskList({ onOpen, onOpenProject }: { onOpen: (id: Id) => void; onOpenProject: (id: Id) => void }) {
  const m = useM();
  const now = useNow(30_000);
  const [view, setView] = useState<View>("recent");
  // The day the Day view shows; null = today, whatever day that is by now.
  const [pickedDay, setPickedDay] = useState<number | null>(null);

  const day = pickedDay ?? startOfDay(now);
  const dayEnd = addDays(day, 1);
  const inView = (t: TaskInfo) => {
    switch (view) {
      case "recent":
        return t.task.status === "open" && !t.inbox;
      case "day":
        return t.sessions.some((s) => s.start < dayEnd && (s.end ?? now) > day);
      case "inbox":
        return t.inbox;
      case "done":
        return t.task.status === "done";
      case "projects":
        return false;
    }
  };
  // The company filter (the profile's groupBy field), remembered on this device.
  const [companyId, setCompanyIdState] = useState<Id | null>(loadFilter);
  const setCompanyId = (id: Id | null) => {
    setCompanyIdState(id);
    try {
      if (id) localStorage.setItem(FILTER_KEY, id);
      else localStorage.removeItem(FILTER_KEY);
    } catch {
      // Not remembered: fine for this visit.
    }
  };
  const company = companyId && m.groupBy ? m.view.lists[companyId] : undefined;
  const ofCompany = (t: TaskInfo) => !company || t.groupItem?.id === company.id;

  // A day's log includes archived tasks; the other views don't.
  const base = (view === "day" ? m.all : m.recent).filter(inView);
  const list = base.filter(ofCompany);
  if (view === "inbox") list.sort((a, b) => b.task.createdAt - a.task.createdAt);

  const inboxCount = m.recent.filter((t) => t.inbox && ofCompany(t)).length;
  const dayTotal = view === "day" ? list.reduce((sum, t) => sum + taskTotals(t, now, day).onDay, 0) : 0;
  const archivedAll = view === "done" ? m.all.filter((t) => t.task.status === "archived") : [];
  const archived = archivedAll.filter(ofCompany);
  // Projects holding the company's tasks (anywhere inside), for the Projects tab.
  let projectIds: Set<Id> | undefined;
  if (company && view === "projects") {
    projectIds = new Set();
    for (const t of m.all) {
      if (!ofCompany(t) || !t.task.projectId) continue;
      for (const p of projectPath(m.view, t.task.projectId)) projectIds.add(p.id);
    }
  }

  const filter = m.groupBy && (
    <span className="company-filter">
      <CompanyFilter field={m.groupBy} value={company ?? null} onChange={setCompanyId} counted={view === "projects" ? [] : [...base, ...archivedAll]} />
    </span>
  );

  return (
    <section className="list" aria-label="Tasks">
      <div className="tabs" role="tablist">
        {(["recent", "day", "inbox", "done", "projects"] as View[]).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            className={`tab ${view === v ? "on" : ""}`}
            onClick={() => setView(v)}
          >
            {v[0]!.toUpperCase() + v.slice(1)}
            {v === "inbox" && inboxCount > 0 && <span className="count">{inboxCount}</span>}
          </button>
        ))}
      </div>

      {/* On Day it sits in the date's row instead. */}
      {filter && view !== "day" && <div className="list-filter">{filter}</div>}

      {view === "projects" && <ProjectList onOpenProject={onOpenProject} only={projectIds} />}

      {view === "day" && (
        <DayNav day={day} onDay={(d) => setPickedDay(d === startOfDay(now) ? null : d)} now={now} after={filter}>
          {list.length > 0 && <span className="muted small nav-total">Total {hm(dayTotal)}</span>}
        </DayNav>
      )}

      <ul className="rows">
        {list.map((t) => (
          <TaskRow key={t.task.id} info={t} now={now} view={view} day={day} onOpen={onOpen} />
        ))}
      </ul>
      {list.length === 0 && view !== "projects" && (
        <p className="empty">
          {company && base.length > 0
            ? `Nothing for ${company.name} here.`
            : view === "day" && pickedDay !== null
              ? "No time tracked that day."
              : EMPTY[view]}
        </p>
      )}

      {archived.length > 0 && (
        <details className="archived">
          <summary>
            Archived · {archived.length}
          </summary>
          <ul className="rows">
            {archived.map((t) => (
              <TaskRow key={t.task.id} info={t} now={now} view={view} onOpen={onOpen} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

const FILTER_KEY = wsKey("sideshow:listCompany");
function loadFilter(): Id | null {
  try {
    return localStorage.getItem(FILTER_KEY);
  } catch {
    return null;
  }
}

/**
 * Narrow the list to one company's tasks: a searchable list of the companies on your tasks,
 * most recently worked first, with how many each has in this tab. (There are hundreds of them,
 * so not a row of chips.)
 */
function CompanyFilter({
  field,
  value,
  onChange,
  counted,
}: {
  field: FieldDef;
  value: ListItem | null;
  onChange: (id: Id | null) => void;
  /** The tab's tasks, for the counts. */
  counted: TaskInfo[];
}) {
  const m = useM();
  const label = field.label.toLowerCase();
  // Every company on a task, most recently worked first (m.all is in that order).
  const companies: ListItem[] = [];
  const seen = new Set<Id>();
  for (const t of m.all) {
    const item = t.groupItem;
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      companies.push(item);
    }
  }
  const counts = new Map<Id, number>();
  for (const t of counted) if (t.groupItem) counts.set(t.groupItem.id, (counts.get(t.groupItem.id) ?? 0) + 1);
  return (
    <ComboPicker
      chip={
        <>
          <span className="muted">{field.label}:</span> {value ? value.name : "All"}
        </>
      }
      chipTitle={value ? `Showing ${value.name}'s tasks only` : `Show one ${label}'s tasks only`}
      set={!!value}
      onClear={() => onChange(null)}
      clearLabel={`All ${label === "company" ? "companies" : `${label}s`}`}
      placeholder={`Find ${label}…`}
      empty={companies.length ? "No match" : `No tasks have a ${label} yet`}
      options={(query) => [
        ...companies
          .filter((c) => !query || c.name.toLowerCase().includes(query))
          .slice(0, query ? 50 : 20)
          .map((c) => {
            const n = counts.get(c.id);
            return {
              key: c.id,
              text: c.name,
              section: query ? undefined : "Recent",
              label: (
                <span className="filter-option">
                  <span>{c.name}</span>
                  {n ? <span className="muted small">{n}</span> : null}
                </span>
              ),
              pick: () => onChange(c.id),
            };
          }),
        ...(value ? [{ key: "-", text: `All ${label === "company" ? "companies" : `${label}s`}`, pick: () => onChange(null) }] : []),
      ]}
    />
  );
}

const EMPTY: Record<View, string> = {
  recent: "Nothing yet. Press ▶ New and start typing.",
  day: "No time tracked today.",
  inbox: "Inbox is empty. Use + Inbox to capture work for later.",
  done: "No finished tasks.",
  projects: "",
};

export function TaskRow({
  info,
  now,
  view,
  day,
  onOpen,
  showProject = true,
}: {
  info: TaskInfo;
  now: number;
  view: View;
  /** The day the Day view shows. */
  day?: number;
  onOpen: (id: Id) => void;
  /** Off on a project's own page, where it would only repeat the page. */
  showProject?: boolean;
}) {
  const m = useM();
  const a = useA();
  const running = m.running.find((s) => s.taskId === info.task.id);
  const { onDay, total } = taskTotals(info, now, day);
  const meta = [
    !running && info.task.pausedAt && "Paused",
    showProject && info.projectPath,
    ...info.fieldTexts,
    view === "inbox" ? `added ${whenLabel(info.task.createdAt, now)}` : whenLabel(info.lastTouched, now),
    view === "day" ? `${hm(onDay)}${day === undefined || day === startOfDay(now) ? " today" : ""}` : total > 0 && hm(total),
  ].filter(Boolean);

  return (
    <li className={`row ${running ? "row-running" : ""}`}>
      <button className="row-main" onClick={() => onOpen(info.task.id)}>
        <span className="row-title">{info.title}</span>
        <span className="row-meta">{meta.join(" · ")}</span>
      </button>
      {running ? (
        <button className="row-live" onClick={() => a.pause(running.id)} aria-label={`Pause ${info.title}`} title="Pause">
          <span className="live-dot" aria-hidden />
          <span className="row-live-label">Running</span>
          <span className="row-live-stop">❚❚ Pause</span>
        </button>
      ) : (
        <button
          className="play"
          onClick={(e) => {
            // Adds to whatever is running; Shift+click switches (stops the others).
            a.continueTask(info.task.id, !e.shiftKey);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          aria-label={`Start ${info.title}`}
          title="Start alongside what's running (Shift+click to switch to just this)"
        >
          ▶
        </button>
      )}
    </li>
  );
}
