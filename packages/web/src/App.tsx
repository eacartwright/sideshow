import type { Id } from "@sideshow/shared";
import { useEffect, useRef, useState } from "react";
import { ClientsDialog } from "./components/ClientsDialog";
import { DayPage, dayPageShown } from "./components/DayPage";
import { DevNotesDialog } from "./components/DevNotes";
import type { DevNotePage } from "./devnotes";
import { HoldsDialog } from "./components/HoldsDialog";
import { InboxAdd } from "./components/InboxAdd";
import { MiniWindow, miniSupported, openMiniWindow } from "./components/MiniWindow";
import { NowPanel } from "./components/NowPanel";
import { ProjectDetail } from "./components/ProjectDetail";
import { SettingsDialog, type SettingsTab } from "./components/Settings";
import { Switcher } from "./components/Switcher";
import { TaskDetail } from "./components/TaskDetail";
import { TaskList } from "./components/TaskList";
import { syncText, useCompanies } from "./companies";
import { useWeekly } from "./weekly";
import { RefreshIcon } from "./components/icons";
import { Spinner } from "./components/Spinner";
import { ActionsContext, ModelContext, useActionsFactory, useModel, type Model } from "./model";
import { dismissToast, showToast, useToast } from "./toast";
import { Lightbox } from "./components/Lightbox";
import { undo } from "./undo";

type Overlay =
  | { kind: "switcher"; alongside?: boolean }
  | { kind: "inbox" }
  | { kind: "settings"; tab?: SettingsTab }
  | { kind: "clients" }
  | { kind: "holds" }
  /** `page`: what was on screen when it opened, for "Include this page". */
  | { kind: "devnotes"; page: DevNotePage }
  | { kind: "project"; projectId: Id }
  /** `back`: where closing returns to (the project page it was opened from). */
  | { kind: "detail"; taskId: Id; back?: Overlay }
  | null;

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export function App() {
  const model = useModel();
  const actions = useActionsFactory();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const close = () => setOverlay(null);
  // Which page fills the screen: Now (the stack and the task list) or the Day page.
  const [page, setPage] = useState<"now" | "day">("now");
  const focusNotesOnNow = useRef(false);
  const modelRef = useRef(model);
  modelRef.current = model;
  const lastNewTap = useRef(-Infinity);
  // The always-on-top mini window, while it's open.
  const [mini, setMini] = useState<Window | null>(null);
  const toggleMini = async () => {
    if (mini) {
      mini.close();
      return;
    }
    try {
      const win = await openMiniWindow();
      win.addEventListener("pagehide", () => setMini(null));
      setMini(win);
    } catch {
      showToast("This browser wouldn't open the mini window");
    }
  };

  // Desktop keyboard shortcuts. Alt+letter works even while typing in notes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay({ kind: "switcher", alongside: e.shiftKey });
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z" && !isTyping(e.target)) {
        // In a text box, Ctrl+Z is the box's own undo.
        e.preventDefault();
        undo();
      } else if (e.key === "/" && !isTyping(e.target) && !overlay) {
        e.preventDefault();
        setOverlay({ kind: "switcher" });
      } else if (
        e.key === "Escape" &&
        pageRef.current === "day" &&
        !isTyping(e.target) &&
        // A dialog (App's, or one the Day page opened itself) takes Esc first.
        !document.querySelector(".backdrop")
      ) {
        setPage("now");
      } else if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const act: Record<string, () => void> = {
          KeyN: () => {
            setOverlay(null);
            startNew(e.shiftKey);
          },
          KeyP: () => {
            // Alt+P pauses the top card; Alt+Shift+P pauses everything.
            const top = modelRef.current.running[0];
            if (e.shiftKey) actions.pause();
            else if (top) actions.pause(top.id);
          },
          KeyW: () => {
            // The top running entry goes to this week's WRIT; with nothing running, start it.
            if (!modelRef.current.config.cwWeekly) return;
            setOverlay(null);
            const top = modelRef.current.running[0];
            if (top) actions.moveToWeekly(top.id);
            else startWeekly(e.shiftKey);
          },
          KeyT: () => {
            // Travel: on what's running, or a new task with nothing running.
            setOverlay(null);
            const top = modelRef.current.running[0];
            if (top) actions.travelEntry(top.id);
            else actions.startTravel(e.shiftKey);
          },
          KeyI: () => setOverlay({ kind: "inbox" }),
          // Dev notes, even over a dialog (which covers 🧪), so the note can name it.
          KeyB: () => setOverlay({ kind: "devnotes", page: here() }),
          KeyE: () => setPage((p) => (p === "day" ? "now" : "day")),
        };
        const fn = act[e.code];
        if (fn) {
          e.preventDefault();
          fn();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, overlay]);

  // ▶ New from the Day page goes back to Now. The notes field isn't mounted until then, so
  // it's focused once Now is back (on the iPhone that can't raise the keyboard, but the Day
  // page is a desktop page).
  const pageRef = useRef(page);
  pageRef.current = page;
  function startNew(alongside: boolean) {
    if (pageRef.current === "day") {
      focusNotesOnNow.current = true;
      setPage("now");
    }
    actions.startNew("", alongside);
  }
  // Ticket info (summary, company, closed) for what's on the Now stack is looked up again each
  // time the app loads, so the header's ↻ refreshes it too. A title renamed here stays.
  const refreshedTickets = useRef(false);
  useEffect(() => {
    if (refreshedTickets.current || !model.loaded || !model.config.cw) return;
    refreshedTickets.current = true;
    const ids = new Set([...model.running.map((s) => s.taskId), ...model.paused.map((t) => t.task.id)]);
    for (const id of ids) void actions.lookupTicket(id, { keepTitle: true });
  }, [model.loaded, model.config.cw, model.running, model.paused, actions]);

  // Alt+W with nothing running: the same, on this week's recurring internal ticket.
  // (Asking for it here keeps it fresh for the running card's WRIT.)
  useWeekly(!!model.config.cwWeekly);
  function startWeekly(alongside: boolean) {
    if (pageRef.current === "day") {
      focusNotesOnNow.current = true;
      setPage("now");
    }
    actions.startWeekly(alongside);
  }
  // What's on screen, for a dev note: the dialog that's open, else the page.
  const here = (): DevNotePage => {
    // Called from the keyboard handler too, so the latest model and page come from refs.
    const m = modelRef.current;
    if (overlay?.kind === "detail") return { label: `Task details: ${m.tasks.get(overlay.taskId)?.titleText || "(untitled)"}`, taskId: overlay.taskId };
    if (overlay?.kind === "project") return { label: `Project: ${m.view.projects[overlay.projectId]?.title ?? ""}` };
    const dialogs: Partial<Record<NonNullable<Overlay>["kind"], string>> = {
      switcher: "Find",
      inbox: "Add to inbox",
      settings: "Settings",
      clients: "Settings › Companies",
      holds: "Schedule holds",
    };
    if (overlay && dialogs[overlay.kind]) return { label: dialogs[overlay.kind]! };
    return { label: pageRef.current === "day" ? dayPageShown : "Now" };
  };

  useEffect(() => {
    if (page === "now" && focusNotesOnNow.current) {
      focusNotesOnNow.current = false;
      actions.notesRef.current?.focus();
    }
  }, [page, actions]);

  return (
    <ModelContext.Provider value={model}>
      <ActionsContext.Provider value={actions}>
        <header className={`app-header ${page === "day" ? "wide" : ""}`}>
          <h1>sideshow</h1>
          {/* With more than one workspace, which one this is (so they can't be mixed up). */}
          {(model.config.workspaces?.length ?? 0) > 1 && model.config.workspace && (
            <button className="ws-badge" onClick={() => setOverlay({ kind: "settings", tab: "workspaces" })} title="Workspace (Settings › Workspaces)">
              {model.config.workspace.name}
            </button>
          )}
          <SyncBadge model={model} />
          <nav className="actionbar" aria-label="Actions">
            <button className="btn" onClick={() => setOverlay({ kind: "switcher" })} title="Find a task (Ctrl+K)">
              <span aria-hidden>⌕</span> Find
            </button>
            <button
              className="btn go new"
              onClick={(e) => {
                // A double tap shouldn't create two tasks.
                if (e.timeStamp - lastNewTap.current < 700) return;
                lastNewTap.current = e.timeStamp;
                startNew(e.shiftKey);
              }}
              title="Start a new task (Alt+N; Shift to run alongside)"
            >
              <span aria-hidden>▶</span> New
            </button>
            <button className="btn" onClick={() => setOverlay({ kind: "inbox" })} title="Add to inbox (Alt+I)">
              + Inbox
            </button>
            <button
              className={`btn ${page === "day" ? "btn-on" : ""}`}
              aria-pressed={page === "day"}
              onClick={() => setPage(page === "day" ? "now" : "day")}
              title="Time entries: the day's sessions, ready to enter (Alt+E)"
            >
              Entries
            </button>
          </nav>
          {/* Beside Entries on a desktop; in the top bar on a phone, where the bottom bar is full. */}
          {model.config.cwHolds && (
            <button className="btn holds-btn" onClick={() => setOverlay({ kind: "holds" })} title="Schedule holds: blocks that repeat on your ConnectWise calendar" aria-label="Holds">
              <span className="wide-only">Holds</span>
              {/* A phone's top bar has room for icons only. */}
              <span className="narrow-only" aria-hidden>
                🗓️
              </span>
            </button>
          )}
          {miniSupported() && (
            <button
              className={`btn icon mini-btn ${mini ? "btn-on" : ""}`}
              aria-pressed={!!mini}
              onClick={() => void toggleMini()}
              title="Mini window: a small one that stays on top of everything, with what's running"
              aria-label="Mini window"
            >
              <MiniIcon />
            </button>
          )}
          {/* The installed iPhone app has no browser reload; unsent changes are already in the outbox. */}
          <button className="btn icon refresh-btn" onClick={() => location.reload()} title="Refresh" aria-label="Refresh">
            <RefreshIcon />
          </button>
          <button className="btn icon devnotes-btn" onClick={() => setOverlay({ kind: "devnotes", page: here() })} title="Dev notes: ideas and bugs about sideshow (Alt+B)" aria-label="Dev notes">
            <span aria-hidden>🧪</span>
          </button>
          <button className="btn icon settings-btn" onClick={() => setOverlay({ kind: "settings" })} title="Settings" aria-label="Settings">
            <GearIcon />
          </button>
        </header>

        {page === "day" ? (
          <main className="page-wide">
            <DayPage onClose={() => setPage("now")} onOpenTask={(taskId) => setOverlay({ kind: "detail", taskId })} />
          </main>
        ) : (
          <main className="layout">
            <NowPanel
              onAlongside={() => setOverlay({ kind: "switcher", alongside: true })}
              onOpen={(taskId) => setOverlay({ kind: "detail", taskId })}
              onFind={() => setOverlay({ kind: "switcher" })}
            />
            <TaskList
              onOpen={(taskId) => setOverlay({ kind: "detail", taskId })}
              onOpenProject={(projectId) => setOverlay({ kind: "project", projectId })}
            />
          </main>
        )}

        {overlay?.kind === "switcher" && <Switcher alongside={overlay.alongside} onClose={close} />}
        {overlay?.kind === "inbox" && <InboxAdd onClose={close} />}
        {overlay?.kind === "settings" && <SettingsDialog initialTab={overlay.tab} onClose={close} onClients={() => setOverlay({ kind: "clients" })} />}
        {overlay?.kind === "clients" && <ClientsDialog onClose={() => setOverlay({ kind: "settings" })} />}
        {overlay?.kind === "holds" && <HoldsDialog onClose={close} />}
        {overlay?.kind === "devnotes" && (
          <DevNotesDialog page={overlay.page} onClose={close} onOpenTask={(taskId) => setOverlay({ kind: "detail", taskId })} />
        )}
        <ToastBar />
        {overlay?.kind === "project" && (
          <ProjectDetail
            key={overlay.projectId}
            projectId={overlay.projectId}
            onOpenProject={(projectId) => setOverlay({ kind: "project", projectId })}
            onOpenTask={(taskId) => setOverlay({ kind: "detail", taskId, back: overlay })}
            onClose={close}
          />
        )}
        {overlay?.kind === "detail" && (
          <TaskDetail taskId={overlay.taskId} onClose={() => setOverlay(overlay.back ?? null)} />
        )}
        {mini && (
          <MiniWindow
            win={mini}
            onFind={() => setOverlay({ kind: "switcher" })}
            onOpenTask={(taskId) => setOverlay({ kind: "detail", taskId })}
          />
        )}
        {/* Last, so it's the top layer over any dialog (Esc closes it first). */}
        <Lightbox />
      </ActionsContext.Provider>
    </ModelContext.Provider>
  );
}

function ToastBar() {
  const toast = useToast();
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.text}</span>
      {toast.action && (
        <button
          className="btn"
          onClick={() => {
            toast.action!.run();
            dismissToast();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

function SyncBadge({ model }: { model: Model }) {
  const { connection, pending, loaded } = model;
  let text = "Synced";
  let tone = "ok";
  if (connection === "signedout") {
    // The outbox keeps everything; reloading goes through the login and picks up where it left off.
    return (
      <button className="sync sync-warn sync-signin" onClick={() => location.reload()}>
        <span className="sync-dot" aria-hidden /> Signed out{pending ? ` · ${pending} unsent` : ""} · Sign in
      </button>
    );
  }
  if (!loaded) [text, tone] = ["Loading…", "wait"];
  else if (connection === "offline") [text, tone] = [pending ? `Offline · ${pending} unsent` : "Offline", "warn"];
  else if (pending) [text, tone] = ["Saving…", "wait"];
  return (
    <>
      <span className={`sync sync-${tone}`} role="status" title={text}>
        <span className="sync-dot" aria-hidden /> <span className="sync-text">{text}</span>
      </span>
      {model.config.cw && <CwSyncBadge />}
    </>
  );
}

/** While the server syncs ConnectWise's companies (the first time takes a minute or two). */
function CwSyncBadge() {
  const cw = useCompanies(true);
  const text = syncText(cw);
  if (!text) return null;
  // On a phone the header has room for a few characters only.
  const short = `CW sync${cw.progress ? ` ${cw.progress.done}/${cw.progress.total}` : "…"}`;
  return (
    <span className="sync sync-wait sync-cw busy-line" role="status" title={text}>
      <Spinner /> <span className="wide-only">{text}</span>
      <span className="narrow-only">{short}</span>
    </span>
  );
}

function MiniIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <rect x="12" y="12" width="6" height="5" rx="1" fill="currentColor" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
