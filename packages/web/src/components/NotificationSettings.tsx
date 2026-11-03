import { useEffect, useState } from "react";
import { badgeOn, badgeSupported, disable, enable, pushSupport, refresh, sendTest, setBadgeOn, setPrefs, type PushPrefs } from "../push";
import { showToast } from "../toast";
import { Spinner } from "./Spinner";

// Settings › Alerts: per device (DESIGN.md §7, "Notifications"). What's running shows as
// a notification on this device (the lock screen, on an iPhone), and a reminder comes when a
// timer has run long. The choices are kept on the server with the device's subscription.

const REMIND_OPTIONS = [0, 1, 2, 3, 4, 6, 8];
const DEFAULTS: PushPrefs = { running: true, remindHours: 3 };

type Status = { on: false } | { on: true; prefs: PushPrefs };

export function NotificationSettings() {
  const support = pushSupport();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (support !== "ok") return;
    refresh()
      .then((prefs) => setStatus(prefs ? { on: true, prefs } : { on: false }))
      .catch(() => setError("Couldn't check this device's notifications: check the connection."));
  }, [support]);

  if (support !== "ok") {
    return (
      <p className="muted small setting-help">
        {support === "install"
          ? "On an iPhone, notifications work in sideshow's Home Screen app: open it from its icon (in Safari or Chrome, Share › Add to Home Screen), then come back here."
          : support === "insecure"
            ? "Notifications need the https address (sideshow.evans.tools or localhost); this page is on plain http."
            : "This browser can't show notifications from sideshow."}
      </p>
    );
  }
  if (error) return <p className="warn small setting-help">{error}</p>;
  if (!status) return <p className="muted small busy-line"><Spinner /> Loading…</p>;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const msg = (err as Error).message;
      setError(
        msg === "blocked" || Notification.permission === "denied"
          ? "Notifications are blocked for sideshow. Allow them in this device's settings (iPhone: Settings › Notifications › sideshow), then try again."
          : msg === "dismissed"
            ? "Not turned on: the question was dismissed."
            : "That didn't work. Check the connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const change = (prefs: PushPrefs) =>
    run(async () => {
      setStatus({ on: true, prefs });
      setStatus({ on: true, prefs: await setPrefs(prefs) });
    });

  if (!status.on) {
    return (
      <>
        <p className="muted small setting-help">
          On this device: a notification saying what's running whenever that changes (on an iPhone it sits on the lock
          screen), and a reminder when a timer has run a long time.
        </p>
        {error && <p className="warn small setting-help">{error}</p>}
        <div className="row-actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            // Straight from the tap: iOS only asks for permission then.
            onClick={() => void run(async () => setStatus({ on: true, prefs: await enable(DEFAULTS) }))}
          >
            {busy ? "Turning on…" : "Turn on notifications"}
          </button>
        </div>
      </>
    );
  }

  const { prefs } = status;
  return (
    <>
      <p className="small conn-status on">● On for this device</p>
      <section className="setting">
        <label className="check-row">
          <input type="checkbox" checked={prefs.running} disabled={busy} onChange={(e) => void change({ ...prefs, running: e.target.checked })} />
          <span className="setting-label">Show what's running</span>
        </label>
        <p className="muted small setting-help">
          Starting, switching, pausing or stopping (on any device) replaces the notification with what's running now. It
          shows when each timer started; a notification can't count by itself.
        </p>
      </section>
      <section className="setting">
        <label htmlFor="remind-hours" className="setting-label">
          Remind me about a long timer
        </label>
        <select
          id="remind-hours"
          className="select setting-select"
          value={prefs.remindHours}
          disabled={busy}
          onChange={(e) => void change({ ...prefs, remindHours: Number(e.target.value) })}
        >
          {(REMIND_OPTIONS.includes(prefs.remindHours) ? REMIND_OPTIONS : [...REMIND_OPTIONS, prefs.remindHours].sort((a, b) => a - b)).map((h) => (
            <option key={h} value={h}>
              {h === 0 ? "Off" : `Every ${h} hour${h === 1 ? "" : "s"}`}
              {h === DEFAULTS.remindHours ? " (default)" : ""}
            </option>
          ))}
        </select>
        <p className="muted small setting-help">For the timer you forgot to stop.</p>
      </section>
      {error && <p className="warn small setting-help">{error}</p>}
      <div className="row-actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await sendTest();
              showToast("Test sent");
            })
          }
        >
          Send a test
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn subtle"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await disable();
              setStatus({ on: false });
            })
          }
        >
          Turn off
        </button>
      </div>
    </>
  );
}

/** The number running on the app's icon, per device. Off by default on Windows, where Chrome puts
 *  the profile picture on the taskbar icon whenever the number is cleared. */
export function BadgeSetting() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (badgeSupported()) void badgeOn().then(setOn).catch(() => {});
  }, []);
  if (on === null) return null;
  return (
    <section className="setting">
      <label className="check-row">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            void setBadgeOn(next).catch(() => {});
          }}
        />
        <span className="setting-label">Number running on the app icon</span>
      </label>
      <p className="muted small setting-help">
        On this device. Off by default on Windows: there Chrome puts your profile picture on the taskbar icon each time
        the number goes away.
      </p>
    </section>
  );
}
