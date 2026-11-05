import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { firstLine, type Id, type Session } from "@sideshow/shared";
import { clock, hm, timeOfDay } from "../format";
import { taskTotals, useA, useM, type TaskInfo } from "../model";

// The mini window (DESIGN.md §7): a small always-on-top window with what's running, for a desktop
// whose screens are full. Document Picture-in-Picture (Chrome and Edge): it floats over every other
// app, and is this page's own UI drawn in a second window, so it stays in sync with no extra work.
// It closes with the tab that opened it.

declare global {
  interface Window {
    documentPictureInPicture?: { requestWindow(options?: { width?: number; height?: number }): Promise<Window> };
  }
}

export const miniSupported = () => "documentPictureInPicture" in window && window.matchMedia("(pointer: fine)").matches;

/** Open the window with this page's styles and colors, keeping its theme in step. */
export async function openMiniWindow(): Promise<Window> {
  const win = await window.documentPictureInPicture!.requestWindow({ width: 380, height: 210 });
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    win.document.head.appendChild(node.cloneNode(true));
  }
  win.document.title = "Sideshow";
  const theme = () => {
    const t = document.documentElement.getAttribute("data-theme");
    if (t) win.document.documentElement.setAttribute("data-theme", t);
  };
  theme();
  const seen = new MutationObserver(theme);
  seen.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  win.addEventListener("pagehide", () => seen.disconnect());
  win.document.body.classList.add("mini-body");
  return win;
}

export function MiniWindow({ win, onFind, onOpenTask }: { win: Window; onFind: () => void; onOpenTask: (taskId: Id) => void }) {
  return createPortal(<MiniPanel win={win} onFind={onFind} onOpenTask={onOpenTask} />, win.document.body);
}

function MiniPanel({ win, onFind, onOpenTask }: { win: Window; onFind: () => void; onOpenTask: (taskId: Id) => void }) {
  const m = useM();
  const a = useA();
  // The window's own clock: a tab in the background has its timers slowed, this window doesn't.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = win.setInterval(() => setNow(Date.now()), 1000);
    return () => win.clearInterval(id);
  }, [win]);
  /** The big app, in front. */
  const full = () => {
    window.focus();
  };
  // Starting a task puts the cursor in the big app's notes, for typing there. Not from here: this
  // window's own box is where the typing goes.
  const leaveNotes = () => a.notesRef.current?.blur();

  return (
    <div className="mini">
      {m.running.length === 0 && (
        <div className="mini-idle">
          <span className="idle-label">Nothing running</span>
          <div className="mini-row">
            <button className="btn primary mini-grow" onClick={() => {
                a.startNew("");
                leaveNotes();
              }}
            >
              ▶ Start
            </button>
            <button
              className="btn"
              onClick={() => {
                full();
                onFind();
              }}
            >
              ⌕ Find
            </button>
          </div>
        </div>
      )}
      {m.running.map((s) => {
        const info = m.tasks.get(s.taskId);
        return info ? <MiniRunning key={s.id} session={s} info={info} now={now} onOpen={() => { full(); onOpenTask(info.task.id); }} /> : null;
      })}
      {m.paused.map((info) => (
        <div key={info.task.id} className="mini-paused">
          <button className="mini-title" title={`${info.title}\nOpen in the full app`} onClick={() => { full(); onOpenTask(info.task.id); }}>
            ❚❚ {info.title}
          </button>
          <span className="muted small nowrap">{hm(taskTotals(info, now).onDay)}</span>
          <button className="btn sm" onClick={() => {
              a.continueTask(info.task.id, true);
              leaveNotes();
            }} aria-label={`Resume ${info.title}`} title={`Resume (paused ${timeOfDay(info.task.pausedAt!)})`}>
            ▶
          </button>
        </div>
      ))}
    </div>
  );
}

function MiniRunning({ session: s, info, now, onOpen }: { session: Session; info: TaskInfo; now: number; onOpen: () => void }) {
  const a = useA();
  return (
    <div className="mini-card">
      <div className="mini-row">
        <span className="live-dot" aria-hidden />
        <span className="mini-timer">{clock(now - s.start)}</span>
        <span className="spacer" />
        <button className="btn sm pause" onClick={() => a.pause(s.id)} aria-label="Pause" title="Pause: stop the clock, keep it on the stack">
          ❚❚
        </button>
        <button className="btn subtle sm icon" onClick={() => a.stop({ sessionId: s.id, taskId: info.task.id })} aria-label="Stop" title="Stop">
          ■
        </button>
      </div>
      <button className="mini-title" onClick={onOpen} title={`${info.title}\nOpen in the full app`}>
        {info.title}
      </button>
      <QuickNote session={s} />
    </div>
  );
}

/**
 * A line added to the running entry's notes: Enter and it's in, with nothing to click into first.
 * A plain box on purpose; the full editor is one click away and this window is for jotting.
 */
function QuickNote({ session: s }: { session: Session }) {
  const a = useA();
  const [text, setText] = useState("");
  const last = firstLine(s.notes, 80);
  return (
    <input
      className="mini-note"
      value={text}
      placeholder={last ? `Add to: ${last}` : "Add a note, then Enter"}
      aria-label="Add to this entry's notes"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || !text.trim()) return;
        const line = text.trim();
        a.updateSession(s.id, { notes: s.notes.trim() ? `${s.notes.trimEnd()}\n\n${line}` : line });
        setText("");
      }}
    />
  );
}
