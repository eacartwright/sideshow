import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { addDevNote, devNotesMarkdown, loadDevNotes, updateDevNote, type DevNote, type DevNoteFile, type DevNotePage } from "../devnotes";
import { showToast } from "../toast";
import { upload } from "../uploads";
import { Dialog } from "./Dialog";
import { showPicture } from "./Lightbox";
import { Spinner } from "./Spinner";

// Dev Notes (🧪 in the header): ideas, bugs and oddities about sideshow itself, kept apart from
// the work (DESIGN.md §7). A note can carry files (📎, or a picture pasted into its box) and the
// page it was written on (off to start, remembered on this device). Copy puts the open ones on
// the clipboard for a work session; the server also keeps them in data/dev-notes.md.

const WITH_PAGE = "sideshow:devNotePage";
const readWithPage = () => {
  try {
    return localStorage.getItem(WITH_PAGE) === "1";
  } catch {
    return false;
  }
};

const fileUrl = (f: DevNoteFile) => `/api/files/${f.id}/${encodeURIComponent(f.name)}`;
const when = (t: number) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });

/** Uploads files one at a time, handing each over; `busy` counts the ones still going. */
function useAttach(onAttach: (f: DevNoteFile) => void) {
  const [busy, setBusy] = useState(0);
  const attach = async (files: File[]) => {
    setBusy((n) => n + files.length);
    for (const file of files) {
      try {
        const u = await upload(file);
        onAttach({ id: u.id, name: u.name, type: u.type });
      } catch (err) {
        showToast((err as Error).message);
      }
      setBusy((n) => n - 1);
    }
  };
  /** A pasted picture (a screenshot) is attached; pasted text goes in as usual. */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (!files.length) return;
    e.preventDefault();
    void attach(files);
  };
  return { busy, attach, onPaste };
}

/** 📎: pick files (on the phone, photos or the camera too). */
function AttachButton({ busy, attach }: { busy: number; attach: (files: File[]) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn icon subtle busy-line" aria-label="Attach a picture or file" title="Attach a picture or file" disabled={busy > 0} onClick={() => input.current?.click()}>
        {busy ? <Spinner /> : "📎"}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void attach([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** A note's files: pictures as small previews (opening full size), the rest by name in a new tab. */
function Attached({ files, onRemove }: { files: DevNoteFile[]; onRemove?: (f: DevNoteFile) => void }) {
  if (!files.length) return null;
  return (
    <span className="dev-files">
      {files.map((f) => (
        <span key={f.id} className="dev-file">
          {f.type.startsWith("image/") ? (
            <button type="button" className="dev-thumb" onClick={() => showPicture(fileUrl(f), f.name)} title={f.name} aria-label={`Open ${f.name}`}>
              <img src={fileUrl(f)} alt={f.name} loading="lazy" />
            </button>
          ) : (
            <a className="btn subtle" href={fileUrl(f)} target="_blank" rel="noreferrer noopener">
              📄 {f.name}
            </a>
          )}
          {onRemove && (
            <button type="button" className="chip-x" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => onRemove(f)}>
              ✕
            </button>
          )}
        </span>
      ))}
    </span>
  );
}

export function DevNotesDialog({ page, onClose, onOpenTask }: { page: DevNotePage; onClose: () => void; onOpenTask: (taskId: string) => void }) {
  const [notes, setNotes] = useState<DevNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<DevNoteFile[]>([]);
  const [withPage, setWithPage] = useState(readWithPage);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const uploads = useAttach((f) => setFiles((fs) => [...fs, f]));
  // The latest list, for changes that finish after others (an upload).
  const latest = useRef<DevNote[]>([]);

  const take = (a: { notes?: DevNote[]; error?: string }) => {
    if (a.notes) {
      latest.current = a.notes;
      setNotes(a.notes);
    }
    setError(a.error ?? null);
    return !a.error;
  };
  useEffect(() => {
    void loadDevNotes().then(take);
  }, []);

  const change = async (id: string, patch: Parameters<typeof updateDevNote>[1]) => take(await updateDevNote(id, patch));
  const changeFiles = (id: string, fn: (files: DevNoteFile[]) => DevNoteFile[]) => {
    const n = latest.current.find((x) => x.id === id);
    if (n) void change(id, { files: fn(n.files) });
  };
  const remove = async (n: DevNote) => {
    if (!(await change(n.id, { deleted: true }))) return;
    showToast("Deleted the note", { label: "Undo", run: () => void change(n.id, { deleted: false }) });
  };

  const add = async () => {
    if (!text.trim() || uploads.busy || adding) return;
    setAdding(true);
    const ok = take(await addDevNote(text.trim(), withPage ? page : null, files));
    setAdding(false);
    if (!ok) return;
    setText("");
    setFiles([]);
  };

  const open = notes?.filter((n) => !n.done) ?? [];
  const done = notes?.filter((n) => n.done) ?? [];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(devNotesMarkdown(open));
      showToast(`Copied ${open.length === 1 ? "1 note" : `${open.length} notes`}`);
    } catch {
      showToast("Couldn't copy here (the clipboard needs https)");
    }
  };
  const row = (n: DevNote) => (
    <NoteRow
      key={n.id}
      n={n}
      onChange={(patch) => void change(n.id, patch)}
      onFiles={(fn) => changeFiles(n.id, fn)}
      onRemove={() => void remove(n)}
      onOpenTask={onOpenTask}
    />
  );

  return (
    <Dialog
      title="Dev notes"
      onClose={onClose}
      className="dev-notes"
      actions={
        open.length > 0 && (
          <button className="btn subtle" onClick={() => void copy()} title="The open notes as a Markdown list">
            Copy
          </button>
        )
      }
    >
      <p className="muted small dev-intro">Ideas, bugs and oddities about sideshow itself. Paste a screenshot into the box to attach it.</p>
      <div className="dev-add">
        <textarea
          className="dev-text"
          rows={2}
          autoFocus
          value={text}
          placeholder="What's the idea or the bug?"
          aria-label="New note"
          onChange={(e) => setText(e.target.value)}
          onPaste={uploads.onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void add();
            }
          }}
        />
        <AttachButton {...uploads} />
        <button className="btn primary" disabled={!text.trim() || uploads.busy > 0 || adding} onClick={() => void add()}>
          Add
        </button>
      </div>
      <Attached files={files} onRemove={(f) => setFiles((fs) => fs.filter((x) => x.id !== f.id))} />
      <label className="check-row dev-page">
        <input
          type="checkbox"
          checked={withPage}
          onChange={(e) => {
            setWithPage(e.target.checked);
            try {
              localStorage.setItem(WITH_PAGE, e.target.checked ? "1" : "0");
            } catch {
              // Not remembered.
            }
          }}
        />
        <span className="small">
          Include this page <span className="muted">({page.label})</span>
        </span>
      </label>
      {error && (
        <p className="warn small" role="alert">
          {error}
        </p>
      )}
      {!notes && !error && (
        <p className="muted small busy-line" role="status">
          <Spinner /> Loading…
        </p>
      )}
      {notes && !open.length && <p className="muted small">No open notes.</p>}
      <ul className="dev-list">{open.map(row)}</ul>
      {done.length > 0 && (
        <>
          <button className="btn subtle dev-done-toggle" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            {showDone ? "Hide" : "Show"} done ({done.length})
          </button>
          {showDone && <ul className="dev-list">{done.map(row)}</ul>}
        </>
      )}
    </Dialog>
  );
}

function NoteRow({
  n,
  onChange,
  onFiles,
  onRemove,
  onOpenTask,
}: {
  n: DevNote;
  onChange: (patch: { text?: string; done?: boolean }) => void;
  onFiles: (fn: (files: DevNoteFile[]) => DevNoteFile[]) => void;
  onRemove: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(n.text);
  const uploads = useAttach((f) => onFiles((fs) => [...fs, f]));
  // Saved when you're done editing (✓, or leaving the box), not as you type.
  const finish = () => {
    if (draft.trim() && draft.trim() !== n.text) onChange({ text: draft.trim() });
    setEditing(false);
  };
  return (
    <li className={`dev-note ${n.done ? "done" : ""}`}>
      <input type="checkbox" checked={n.done} aria-label={n.done ? "Not done" : "Done"} title={n.done ? "Not done" : "Done"} onChange={(e) => onChange({ done: e.target.checked })} />
      <span className="dev-main">
        {editing ? (
          <textarea
            className="dev-text"
            autoFocus
            rows={Math.min(8, draft.split("\n").length + 1)}
            value={draft}
            aria-label="Note"
            onChange={(e) => setDraft(e.target.value)}
            onPaste={uploads.onPaste}
            onBlur={finish}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setDraft(n.text);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span className="dev-note-text">{n.text}</span>
        )}
        <span className="muted small">
          {when(n.createdAt)}
          {n.page && (
            <>
              {" · "}
              {n.page.taskId ? (
                <button type="button" className="link-btn" onClick={() => onOpenTask(n.page!.taskId!)}>
                  {n.page.label}
                </button>
              ) : (
                n.page.label
              )}
            </>
          )}
        </span>
        <Attached files={n.files} onRemove={editing ? (f) => onFiles((fs) => fs.filter((x) => x.id !== f.id)) : undefined} />
      </span>
      <span className="dev-actions">
        <AttachButton {...uploads} />
        <button
          type="button"
          className="btn icon subtle"
          aria-label={editing ? "Done editing" : "Edit note"}
          title={editing ? "Done editing" : "Edit"}
          // Before the box's blur, so ✓ doesn't toggle editing back on.
          onMouseDown={(e) => editing && e.preventDefault()}
          onClick={() => {
            if (editing) finish();
            else {
              setDraft(n.text);
              setEditing(true);
            }
          }}
        >
          {editing ? "✓" : "✎"}
        </button>
        <button type="button" className="btn icon subtle" aria-label="Delete note" title="Delete" onClick={onRemove}>
          ✕
        </button>
      </span>
    </li>
  );
}
