import type { Id } from "@sideshow/shared";
import { useEffect, useRef, useState } from "react";
import { ClientsDialog } from "./components/ClientsDialog";
import { DayPage } from "./components/DayPage";
import { InboxAdd } from "./components/InboxAdd";
import { NowPanel } from "./components/NowPanel";
import { ProjectDetail } from "./components/ProjectDetail";
import { SettingsDialog } from "./components/Settings";
import { Switcher } from "./components/Switcher";
import { TaskDetail } from "./components/TaskDetail";
import { TaskList } from "./components/TaskList";
import { syncText, useCompanies } from "./companies";
import { RefreshIcon } from "./components/icons";
import { Spinner } from "./components/Spinner";
import { ActionsContext, ModelContext, useActionsFactory, useModel, type Model } from "./model";
import { dismissToast, useToast } from "./toast";

type Overlay =
  | { kind: "switcher"; alongside?: boolean }
  | { kind: "inbox" }
  | { kind: "settings" }
  | { kind: "clients" }
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

  // Desktop keyboard shortcuts. Alt+letter works even while typing in notes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay({ kind: "switcher", alongside: e.shiftKey });
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
          KeyI: () => setOverlay({ kind: "inbox" }),
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
          <SyncBadge model={model} />
          <nav className="actionbar" aria-label="Actions">
            <button className="btn" onClick={() => setOverlay({ kind: "switcher" })} title="Find a task (Ctrl+K)">
              <span aria-hidden>⌕</span> Find
            </button>
            <button
              className="btn primary new"
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
          {/* The installed iPhone app has no browser reload; unsent changes are already in the outbox. */}
          <button className="btn icon refresh-btn" onClick={() => location.reload()} title="Refresh" aria-label="Refresh">
            <RefreshIcon />
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
            />
            <TaskList
              onOpen={(taskId) => setOverlay({ kind: "detail", taskId })}
              onOpenProject={(projectId) => setOverlay({ kind: "project", projectId })}
            />
          </main>
        )}

        {overlay?.kind === "switcher" && <Switcher alongside={overlay.alongside} onClose={close} />}
        {overlay?.kind === "inbox" && <InboxAdd onClose={close} />}
        {overlay?.kind === "settings" && <SettingsDialog onClose={close} onClients={() => setOverlay({ kind: "clients" })} />}
        {overlay?.kind === "clients" && <ClientsDialog onClose={() => setOverlay({ kind: "settings" })} />}
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
      <span className={`sync sync-${tone}`} role="status">
        <span className="sync-dot" aria-hidden /> {text}
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

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
