import { startOfDay, type Id } from "@sideshow/shared";
import { useState } from "react";
import { hm, whenLabel } from "../format";
import { taskTotals, useA, useM, useNow, type TaskInfo } from "../model";
import { addDays, DayNav } from "./DayNav";
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
  // A day's log includes archived tasks; the other views don't.
  const list = (view === "day" ? m.all : m.recent).filter(inView);
  if (view === "inbox") list.sort((a, b) => b.task.createdAt - a.task.createdAt);

  const inboxCount = m.recent.filter((t) => t.inbox).length;
  const dayTotal = view === "day" ? list.reduce((sum, t) => sum + taskTotals(t, now, day).onDay, 0) : 0;
  const archived = view === "done" ? m.all.filter((t) => t.task.status === "archived") : [];

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

      {view === "projects" && <ProjectList onOpenProject={onOpenProject} />}

      {view === "day" && (
        <DayNav day={day} onDay={(d) => setPickedDay(d === startOfDay(now) ? null : d)} now={now}>
          {list.length > 0 && <span className="muted small">Total {hm(dayTotal)}</span>}
        </DayNav>
      )}

      <ul className="rows">
        {list.map((t) => (
          <TaskRow key={t.task.id} info={t} now={now} view={view} day={day} onOpen={onOpen} />
        ))}
      </ul>
      {list.length === 0 && view !== "projects" && (
        <p className="empty">{view === "day" && pickedDay !== null ? "No time tracked that day." : EMPTY[view]}</p>
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
