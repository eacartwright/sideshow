import type { Id } from "@sideshow/shared";
import { useState } from "react";
import { whenLabel } from "../format";
import { useA, useM, useNow } from "../model";
import { InlineAdd } from "./fields";

// The Projects tab: every project that isn't archived, as a tree. Tap one to open its page.

export function ProjectList({ onOpenProject }: { onOpenProject: (id: Id) => void }) {
  const m = useM();
  const a = useA();
  const now = useNow(30_000);
  const [title, setTitle] = useState("");

  // What's directly in each project: open tasks, inbox items, and when it was last worked on.
  const stats = new Map<Id, { open: number; inbox: number; last: number }>();
  for (const t of m.recent) {
    const id = t.task.projectId;
    if (!id || t.task.status !== "open") continue;
    const s = stats.get(id) ?? { open: 0, inbox: 0, last: 0 };
    if (t.inbox) s.inbox += 1;
    else {
      s.open += 1;
      s.last = Math.max(s.last, t.lastTouched);
    }
    stats.set(id, s);
  }

  return (
    <>
      <InlineAdd value={title} onValue={setTitle} placeholder="New project…" onAdd={(t) => a.createProject(t, null)} />
      <ul className="rows">
        {m.projects.map(({ project, depth }) => {
          const s = stats.get(project.id);
          const meta = [
            project.status === "done" && "Done",
            s?.open && `${s.open} open`,
            s?.inbox && `${s.inbox} in inbox`,
            s?.last && whenLabel(s.last, now),
          ].filter(Boolean);
          return (
            <li key={project.id} className="row" style={{ marginLeft: depth * 16 }}>
              <button className="row-main" onClick={() => onOpenProject(project.id)}>
                <span className="row-title">{project.title || "Untitled project"}</span>
                {meta.length > 0 && <span className="row-meta">{meta.join(" · ")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {m.projects.length === 0 && (
        <p className="empty">No projects yet. Add one above, or pick a project in a task's details.</p>
      )}
    </>
  );
}
