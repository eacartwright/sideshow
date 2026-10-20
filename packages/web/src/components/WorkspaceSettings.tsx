import { useEffect, useState } from "react";
import { useM } from "../model";
import { api, sync } from "../sync";
import { showToast } from "../toast";
import { switchWorkspace, unsentIn, workspaceId } from "../workspace";
import { ConfirmDialog } from "./ConfirmDialog";
import { Spinner } from "./Spinner";

// Settings › Workspaces (DESIGN.md §4): separate sets of data, each with its own profile. Which
// one this device shows is chosen here, per device. A workspace's profile is a lens over its
// data: changing it hides or shows fields, and never deletes a value.

interface WorkspaceRow {
  id: string;
  name: string;
  /** The profile's file name, "" for none. */
  profile: string;
  profileName: string;
}
interface ProfileChoice {
  file: string;
  name: string;
}

const NONE = "No profile (plain time tracker)";

export function WorkspaceSettings() {
  const m = useM();
  const [list, setList] = useState<{ workspaces: WorkspaceRow[]; profiles: ProfileChoice[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ ws: WorkspaceRow; profile: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<{ name: string; profile: string } | null>(null);

  const load = async () => {
    try {
      setList(await (await api("/api/workspaces")).json());
      setError(null);
    } catch {
      setError("Couldn't load the workspaces: check the connection.");
    }
  };
  // Again when the names or a profile change (a config event reloads the state, and m with it).
  useEffect(() => void load(), [m.config.workspaces, m.config.profile]);

  const profileName = (file: string) => (file ? (list?.profiles.find((p) => p.file === file)?.name ?? file) : NONE);
  const post = async (path: string, body: object) => {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((out as { error?: string }).error || "Couldn't save that");
    return out as { id?: string };
  };

  const open = async (id: string) => {
    // This workspace's unsent changes go first, so they don't wait here until you're back.
    if (m.pending && !(await sync.sendNow())) {
      showToast(`${m.pending} change${m.pending === 1 ? "" : "s"} here aren't sent yet: they'll go when you come back to this workspace`);
    }
    switchWorkspace(id);
  };

  const changeProfile = async () => {
    if (!asking) return;
    setBusy(true);
    try {
      await sync.sendNow();
      await post(`/api/workspaces/${encodeURIComponent(asking.ws.id)}`, { profile: asking.profile });
      showToast(`${asking.ws.name} now uses ${profileName(asking.profile)}. A copy of its data was saved first.`);
      setAsking(null);
      await load();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!adding?.name.trim()) return;
    setBusy(true);
    try {
      await post("/api/workspaces", { name: adding.name.trim(), profile: adding.profile });
      setAdding(null);
      await load();
    } catch (err) {
      showToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="warn small setting-help">{error}</p>;
  if (!list) return <p className="muted small busy-line"><Spinner /> Loading…</p>;

  return (
    <>
      <p className="muted small setting-help">
        Each workspace is its own set of tasks and time, with its own fields (profile). Nothing in one shows in another. Which one
        you see is chosen on each device.
      </p>
      <ul className="ws-list">
        {list.workspaces.map((w) => {
          const here = w.id === workspaceId;
          const unsent = here ? 0 : unsentIn(w.id);
          return (
            <li key={w.id} className={`ws-row ${here ? "here" : ""}`}>
              <div className="ws-main">
                {here ? (
                  <RenameInput ws={w} onSave={async (name) => {
                    try {
                      await post(`/api/workspaces/${encodeURIComponent(w.id)}`, { name });
                      await load();
                    } catch (err) {
                      showToast((err as Error).message);
                    }
                  }} />
                ) : (
                  <span className="ws-name">{w.name}</span>
                )}
                <span className="muted small">
                  {w.profile ? w.profileName : NONE}
                  {unsent ? ` · ${unsent} unsent change${unsent === 1 ? "" : "s"} on this device` : ""}
                </span>
              </div>
              {here ? (
                <span className="ws-here small">On this device</span>
              ) : (
                <button className="btn" onClick={() => void open(w.id)}>
                  Open
                </button>
              )}
              {here && (
                <label className="ws-profile">
                  <span className="copy-label">Profile</span>
                  <select
                    className="select"
                    value={w.profile}
                    onChange={(e) => setAsking({ ws: w, profile: e.target.value })}
                  >
                    <option value="">{NONE}</option>
                    {list.profiles.map((p) => (
                      <option key={p.file} value={p.file}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <form
          className="ws-add"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            className="search"
            autoFocus
            value={adding.name}
            placeholder="Name, e.g. Personal"
            aria-label="New workspace's name"
            maxLength={60}
            onChange={(e) => setAdding({ ...adding, name: e.target.value })}
          />
          <select className="select" value={adding.profile} aria-label="Its profile" onChange={(e) => setAdding({ ...adding, profile: e.target.value })}>
            <option value="">{NONE}</option>
            {list.profiles.map((p) => (
              <option key={p.file} value={p.file}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="row-actions">
            <button type="button" className="btn" onClick={() => setAdding(null)}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy || !adding.name.trim()}>
              Create
            </button>
          </span>
        </form>
      ) : (
        <button className="btn" onClick={() => setAdding({ name: "", profile: "" })}>
          + New workspace
        </button>
      )}

      {asking && (
        <ConfirmDialog
          title="Change the profile?"
          confirm={busy ? "Changing…" : `Use ${profileName(asking.profile)}`}
          onCancel={() => setAsking(null)}
          onConfirm={() => void changeProfile()}
        >
          <p>
            <strong>{asking.ws.name}</strong>: {profileName(asking.ws.profile)} → <strong>{profileName(asking.profile)}</strong>
          </p>
          <p>
            Nothing is deleted. Fields the new profile doesn't have (and their values) are hidden, and come back as they were if you
            switch back. Pushed entries keep their link to ConnectWise. Lists the new profile brings (work types) are added if this
            workspace doesn't have them yet.
          </p>
          <p className="muted">A copy of this workspace's data is saved first. Every device on this workspace changes with it.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** The workspace's name, saved on Enter or leaving the box. */
function RenameInput({ ws, onSave }: { ws: WorkspaceRow; onSave: (name: string) => void }) {
  const [v, setV] = useState(ws.name);
  useEffect(() => setV(ws.name), [ws.name]);
  const save = () => {
    const name = v.trim();
    if (name && name !== ws.name) onSave(name);
    else setV(ws.name);
  };
  return (
    <input
      className="ws-name-input"
      value={v}
      maxLength={60}
      aria-label="This workspace's name"
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
