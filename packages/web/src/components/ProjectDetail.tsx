import { projectPath, type Id } from "@sideshow/shared";
import { useState } from "react";
import { useA, useM, useNow } from "../model";
import { Dialog } from "./Dialog";
import { DraftInput, DraftTextarea, InlineAdd, ProjectPicker, TitleInput } from "./fields";
import { TaskRow } from "./TaskList";

// One project: where it sits, its subprojects and its tasks (open, inbox, done).
// Tasks in subprojects show on the subproject's own page.

export function ProjectDetail({
  projectId,
  onOpenProject,
  onOpenTask,
  onClose,
}: {
  projectId: Id;
  onOpenProject: (id: Id) => void;
  onOpenTask: (id: Id) => void;
  onClose: () => void;
}) {
  const m = useM();
  const a = useA();
  const now = useNow(30_000);
  const [sub, setSub] = useState("");
  const [task, setTask] = useState("");
  const project = m.view.projects[projectId];
  if (!project) return null;

  const ancestors = projectPath(m.view, projectId).slice(0, -1);
  const children = m.projects.filter((p) => p.project.parentId === projectId);
  const tasks = m.recent.filter((t) => t.task.projectId === projectId);
  const open = tasks.filter((t) => t.task.status === "open" && !t.inbox);
  const inbox = tasks.filter((t) => t.inbox).sort((x, y) => y.task.createdAt - x.task.createdAt);
  const done = tasks.filter((t) => t.task.status === "done");

  return (
    <Dialog title="Project" onClose={onClose} className="detail">
      <div className="stack">
        {ancestors.length > 0 && (
          <nav className="crumbs small" aria-label="Inside">
            {ancestors.map((p) => (
              <button key={p.id} className="btn subtle" onClick={() => onOpenProject(p.id)}>
                {p.title || "Untitled project"} ›
              </button>
            ))}
          </nav>
        )}
        <TitleInput
          className="title-input"
          value={project.title}
          placeholder="Project name"
          aria-label="Project name"
          resetKey={projectId}
          onValue={(title) => a.updateProject(projectId, { title })}
        />
        <div className="row-actions">
          {project.parentId && <span className="muted small">Inside</span>}
          <ProjectPicker
            value={project.parentId}
            onChange={(parentId) => a.updateProject(projectId, { parentId })}
            none="Top level"
            empty="+ Put inside a project"
            exclude={projectId}
          />
        </div>
        <DraftTextarea
          className="description"
          value={project.description}
          placeholder="Description (optional context)"
          aria-label="Description"
          resetKey={projectId}
          onValue={(description) => a.updateProject(projectId, { description })}
        />
        <div className="row-actions">
          <button
            className="btn primary"
            onClick={() => {
              a.startNew("", false, projectId);
              onClose();
            }}
            title="Start a new task in this project"
          >
            ▶ New here
          </button>
          <span className="spacer" />
          {project.status === "open" ? (
            <button className="btn" onClick={() => a.updateProject(projectId, { status: "done" })}>
              Mark done
            </button>
          ) : (
            <button className="btn" onClick={() => a.updateProject(projectId, { status: "open" })}>
              Reopen
            </button>
          )}
          {project.status !== "archived" && (
            <button
              className="btn"
              onClick={() => {
                a.updateProject(projectId, { status: "archived" });
                onClose();
              }}
            >
              Archive
            </button>
          )}
        </div>
      </div>

      <section className="project-section">
        <h3>Subprojects</h3>
        {children.length > 0 && (
          <ul className="rows">
            {children.map(({ project: p }) => (
              <li key={p.id} className="row">
                <button className="row-main" onClick={() => onOpenProject(p.id)}>
                  <span className="row-title">{p.title || "Untitled project"}</span>
                  {p.status === "done" && <span className="row-meta">Done</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <InlineAdd
          value={sub}
          onValue={setSub}
          placeholder="New subproject…"
          onAdd={(title) => a.createProject(title, projectId)}
        />
      </section>

      <section className="project-section">
        <h3>Tasks</h3>
        {open.length > 0 && (
          <ul className="rows">
            {open.map((t) => (
              <TaskRow key={t.task.id} info={t} now={now} view="recent" onOpen={onOpenTask} showProject={false} />
            ))}
          </ul>
        )}
        {open.length === 0 && inbox.length === 0 && <p className="muted small">No open tasks.</p>}
      </section>

      <section className="project-section">
        <h3>Inbox</h3>
        {inbox.length > 0 && (
          <ul className="rows">
            {inbox.map((t) => (
              <TaskRow key={t.task.id} info={t} now={now} view="inbox" onOpen={onOpenTask} showProject={false} />
            ))}
          </ul>
        )}
        <InlineAdd value={task} onValue={setTask} placeholder="Add to inbox…" onAdd={(title) => a.addInbox(title, projectId)} />
      </section>

      {done.length > 0 && (
        <section className="project-section">
          <h3>Done</h3>
          <ul className="rows">
            {done.map((t) => (
              <TaskRow key={t.task.id} info={t} now={now} view="done" onOpen={onOpenTask} showProject={false} />
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}
