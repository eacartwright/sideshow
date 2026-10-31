import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import webpush from "web-push";
import { displayTitle, liveSessions, openSessions, type State } from "@sideshow/shared";
import type { Store } from "./store";

// Notifications on a device while something is running (DESIGN.md §7, "Notifications"): Web
// Push, which an iPhone gets in a Home Screen web app. A device turns them on in Settings ›
// Notifications; its subscription is kept here with the workspace it's in and its choices.
// When what's running in a workspace changes, every device on it gets one notification saying
// what's running now (or that nothing is), and a reminder when a timer has run long. The
// device's service worker (web/public/sw.js) words it in its own time zone and sets the badge.
//
// iOS drops a subscription whose pushes don't show a notification, so every push shows one;
// "stopped" replaces the running one rather than clearing it silently.
//
// Kept in data/push.json, not a workspace's database: a device isn't part of anyone's data,
// and the VAPID keys (which the subscriptions are tied to) belong to the server.

export interface PushPrefs {
  /** A notification saying what's running whenever that changes. */
  running: boolean;
  /** A reminder each time a session has run this many more hours. 0: none. */
  remindHours: number;
}
export const DEFAULT_PREFS: PushPrefs = { running: true, remindHours: 3 };

interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  workspace: string;
  /** The page it was made on (https://sideshow.evans.tools): the VAPID subject. */
  origin: string;
  prefs: PushPrefs;
  createdAt: number;
}

interface PushFile {
  vapid: { publicKey: string; privateKey: string };
  subscriptions: Subscription[];
}

/** What a push carries; the service worker turns it into the notification. */
export interface PushPayload {
  kind: "running" | "reminder" | "test";
  running: { title: string; start: number }[];
  /** Tasks paused on the Now stack, when nothing is running. */
  paused: string[];
  /** What just stopped, when nothing is running. */
  stopped: string[];
}

interface Watched {
  store: Store;
  timer?: ReturnType<typeof setTimeout>;
  last: Running[];
}
type Running = { sessionId: string; title: string; start: number };

/** Waits this long after a change, so a switch (stop + start) or a title being typed is one push. */
const SETTLE_MS = 4000;

export function prefsFrom(x: any, base: PushPrefs = DEFAULT_PREFS): PushPrefs {
  return {
    running: typeof x?.running === "boolean" ? x.running : base.running,
    remindHours: typeof x?.remindHours === "number" && x.remindHours >= 0 && x.remindHours <= 24 ? x.remindHours : base.remindHours,
  };
}

export function running(state: State): Running[] {
  const sessions = liveSessions(state);
  return openSessions(state)
    .flatMap((s) => {
      const task = state.tasks[s.taskId];
      if (!task || task.deleted) return [];
      const own = sessions.filter((x) => x.taskId === task.id).sort((a, b) => a.start - b.start);
      return [{ sessionId: s.id, title: displayTitle(task, own).text, start: s.start }];
    })
    .sort((a, b) => b.start - a.start);
}

function paused(state: State): string[] {
  const sessions = liveSessions(state);
  return Object.values(state.tasks)
    .filter((t) => t.pausedAt && !t.deleted && t.status === "open")
    .sort((a, b) => (b.pausedAt ?? 0) - (a.pausedAt ?? 0))
    .map((t) => displayTitle(t, sessions.filter((s) => s.taskId === t.id).sort((a, b) => a.start - b.start)).text);
}

const same = (a: Running[], b: Running[]) =>
  a.length === b.length && a.every((r, i) => r.sessionId === b[i]?.sessionId && r.title === b[i]?.title && r.start === b[i]?.start);

export class Push {
  private data: PushFile;
  private watched = new Map<string, Watched>();
  /** Reminders sent: "<endpoint> <sessionId>" → how many. In memory: a restart may repeat one. */
  private reminded = new Map<string, number>();
  private ticker: ReturnType<typeof setInterval>;

  constructor(
    private file: string,
    private log: (msg: string) => void = console.log,
    /** Sends one push (tests replace it). Resolves with the push service's status code. */
    private sendRaw: (sub: Subscription, body: string, vapid: PushFile["vapid"]) => Promise<number> = sendWebPush,
  ) {
    if (existsSync(file)) {
      this.data = JSON.parse(readFileSync(file, "utf8")) as PushFile;
    } else {
      this.data = { vapid: webpush.generateVAPIDKeys(), subscriptions: [] };
      this.save();
    }
    this.ticker = setInterval(() => this.remind(), 60_000);
    this.ticker.unref();
  }

  get publicKey() {
    return this.data.vapid.publicKey;
  }

  close() {
    clearInterval(this.ticker);
    for (const w of this.watched.values()) clearTimeout(w.timer);
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  /** The device's subscription, made or updated: it's now on `workspace`. Returns its choices. */
  subscribe(x: any, workspace: string, origin: string, prefs?: unknown): PushPrefs | null {
    const endpoint = x?.endpoint;
    const keys = x?.keys;
    if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") return null;
    const old = this.data.subscriptions.find((s) => s.endpoint === endpoint);
    const sub: Subscription = {
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      workspace,
      origin,
      prefs: prefsFrom(prefs, old?.prefs),
      createdAt: old?.createdAt ?? Date.now(),
    };
    this.data.subscriptions = [...this.data.subscriptions.filter((s) => s.endpoint !== endpoint), sub];
    this.save();
    return sub.prefs;
  }

  unsubscribe(endpoint: string) {
    const before = this.data.subscriptions.length;
    this.data.subscriptions = this.data.subscriptions.filter((s) => s.endpoint !== endpoint);
    if (this.data.subscriptions.length !== before) this.save();
  }

  has(endpoint: string) {
    return this.data.subscriptions.some((s) => s.endpoint === endpoint);
  }

  /** Watch a workspace: its devices hear when what's running changes. */
  watch(id: string, store: Store) {
    const w: Watched = { store, last: running(store.state) };
    this.watched.set(id, w);
    store.onChange(() => {
      clearTimeout(w.timer);
      w.timer = setTimeout(() => this.changed(id, w), SETTLE_MS);
      w.timer.unref?.();
    });
  }

  private changed(id: string, w: Watched) {
    const now = running(w.store.state);
    if (same(now, w.last)) return;
    const stopped = now.length ? [] : w.last.map((r) => r.title);
    w.last = now;
    const payload: PushPayload = { kind: "running", running: now.map(({ title, start }) => ({ title, start })), paused: now.length ? [] : paused(w.store.state), stopped };
    const subs = this.data.subscriptions.filter((s) => s.workspace === id && s.prefs.running);
    if (!subs.length) return;
    void this.sendTo(subs, payload).then((sent) => this.log(`[${id}] push: ${now.length} running, sent to ${sent} of ${subs.length} devices`));
  }

  /** Every minute: a reminder for each session that has run another `remindHours`. */
  remind(at = Date.now()) {
    for (const [id, w] of this.watched) {
      const now = running(w.store.state);
      if (!now.length) continue;
      for (const sub of this.data.subscriptions) {
        if (sub.workspace !== id || !sub.prefs.remindHours) continue;
        for (const r of now) {
          const due = Math.floor((at - r.start) / (sub.prefs.remindHours * 3_600_000));
          const key = `${sub.endpoint} ${r.sessionId}`;
          if (due < 1 || due <= (this.reminded.get(key) ?? 0)) continue;
          this.reminded.set(key, due);
          void this.sendTo([sub], { kind: "reminder", running: now.map(({ title, start }) => ({ title, start })), paused: [], stopped: [] });
          break; // One reminder per device per tick, however many are running.
        }
      }
    }
  }

  /** A test notification to one device. False if it isn't subscribed or the push failed. */
  async test(endpoint: string): Promise<boolean> {
    const sub = this.data.subscriptions.find((s) => s.endpoint === endpoint);
    if (!sub) return false;
    const w = this.watched.get(sub.workspace);
    const now = w ? running(w.store.state) : [];
    const sent = await this.sendTo([sub], { kind: "test", running: now.map(({ title, start }) => ({ title, start })), paused: [], stopped: [] });
    return sent === 1;
  }

  private async sendTo(subs: Subscription[], payload: PushPayload): Promise<number> {
    const body = JSON.stringify(payload);
    let sent = 0;
    await Promise.all(
      subs.map(async (sub) => {
        try {
          const status = await this.sendRaw(sub, body, this.data.vapid);
          if (status === 404 || status === 410) {
            // The device unsubscribed, or the browser dropped it.
            this.log(`push: subscription gone (${status}), removed`);
            this.unsubscribe(sub.endpoint);
          } else if (status >= 200 && status < 300) {
            sent++;
          } else {
            this.log(`push: ${new URL(sub.endpoint).host} answered ${status}`);
          }
        } catch (err) {
          this.log(`push: couldn't send to ${new URL(sub.endpoint).host}: ${(err as Error).message}`);
        }
      }),
    );
    return sent;
  }
}

/** The VAPID subject: the app's https address, or SIDESHOW_PUSH_SUBJECT. Apple refuses localhost ones. */
function subject(sub: Subscription) {
  if (process.env.SIDESHOW_PUSH_SUBJECT) return process.env.SIDESHOW_PUSH_SUBJECT;
  return /^https:\/\/(?!localhost)/.test(sub.origin) ? sub.origin : "mailto:sideshow@example.com";
}

async function sendWebPush(sub: Subscription, body: string, vapid: PushFile["vapid"]): Promise<number> {
  try {
    const res = await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, {
      vapidDetails: { subject: subject(sub), ...vapid },
      TTL: 6 * 3600,
      urgency: "high",
      // A newer push replaces one not yet delivered (a phone that was offline gets the latest).
      topic: "running",
    });
    return res.statusCode;
  } catch (err) {
    if (err instanceof webpush.WebPushError) return err.statusCode;
    throw err;
  }
}
