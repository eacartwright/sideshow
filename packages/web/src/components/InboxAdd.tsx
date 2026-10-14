import type { Fields, Id } from "@sideshow/shared";
import { useRef, useState } from "react";
import { useA, useM } from "../model";
import { Dialog } from "./Dialog";
import { FieldInput, ProjectPicker } from "./fields";

// Capture work for later without touching the clock. Stays open so several
// items ("they also mentioned the printer and the wifi") go in one after another.

export function InboxAdd({ onClose, projectId: inProject }: { onClose: () => void; projectId?: Id }) {
  const m = useM();
  const a = useA();
  const top = m.running[0];
  const runningTask = top ? m.tasks.get(top.taskId)?.task : undefined;
  const [title, setTitle] = useState("");
  // Starts with the client of whatever is being worked on (usually where the new work came from).
  const [fields, setFields] = useState<Fields>(() => {
    const key = m.groupBy?.key;
    const v = key && runningTask?.fields[key];
    return key && v ? { [key]: v } : {};
  });
  // Opened from a project page: that project. Otherwise the one being worked on.
  const [projectId, setProjectId] = useState<Id | null>(inProject ?? runningTask?.projectId ?? null);
  const [added, setAdded] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const add = () => {
    const t = title.trim();
    if (!t) return;
    a.addInbox(t, projectId, fields);
    // Keep the client and project for the next item; a ticket # belongs to one item only.
    setFields((f) => Object.fromEntries(Object.entries(f).filter(([k]) => m.profile.fields.find((d) => d.key === k)?.type === "list")));
    setAdded((xs) => [t, ...xs]);
    setTitle("");
    input.current?.focus();
  };

  return (
    <Dialog title="Add to inbox" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          ref={input}
          autoFocus
          className="search"
          value={title}
          placeholder="What needs doing?"
          autoCapitalize="sentences"
          aria-label="Task title"
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="row-actions">
          <ProjectPicker value={projectId} onChange={setProjectId} />
          {m.profile.fields
            .filter((d) => d.on === "task")
            .map((d) => (
              <FieldInput
                key={d.key}
                def={d}
                value={fields[d.key]}
                clearable
                onChange={(v) =>
                  setFields(({ [d.key]: _, ...rest }) => (v === null || v === "" || v === false ? rest : { ...rest, [d.key]: v }))
                }
              />
            ))}
          <span className="spacer" />
          <button type="submit" className="btn primary" disabled={!title.trim()}>
            Add
          </button>
        </div>
      </form>
      {added.length > 0 && (
        <ul className="added">
          {added.map((t, i) => (
            <li key={i}>✓ {t}</li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
