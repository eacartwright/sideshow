import { openSessions } from "@sideshow/shared";
import { api, sync } from "./sync";

// Notifications on this device (DESIGN.md §7, "Notifications"): the service worker
// (public/sw.js) shows what the server pushes (server/src/push.ts). Turned on per device in
// Settings › Alerts. While the app is open it also keeps the icon's badge itself.

export interface PushPrefs {
  running: boolean;
  remindHours: number;
}

/** Whether this device can have them: "install" = an iPhone outside its Home Screen app. */
export type PushSupport = "ok" | "install" | "insecure" | "unsupported";

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return "insecure";
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (!("PushManager" in window) || !("Notification" in window)) return isIos() && !standalone() ? "install" : "unsupported";
  return "ok";
}

async function post(path: string, body: object): Promise<any> {
  const res = await api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const registration = () => navigator.serviceWorker.ready;

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  return (await registration()).pushManager.getSubscription();
}

/** Its subscription and choices, telling the server it's on this workspace. Null if it has none. */
export async function refresh(): Promise<PushPrefs | null> {
  let sub = await currentSubscription();
  if (!sub) return null;
  // Made with other keys (the server's data/push.json was replaced): its pushes would be
  // refused, so subscribe again with the server's key.
  const { publicKey } = (await (await api("/api/push")).json()) as { publicKey: string };
  const key = sub.options.applicationServerKey;
  if (key && !sameBytes(new Uint8Array(key), keyBytes(publicKey))) {
    await sub.unsubscribe();
    sub = await (await registration()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  return (await post("/api/push/subscribe", { subscription: sub.toJSON() })).prefs as PushPrefs;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Turn them on. Must run straight from a tap: iOS asks for permission only then. Throws with
 * something to show if it can't.
 */
export async function enable(prefs?: PushPrefs): Promise<PushPrefs> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "blocked" : "dismissed");
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = (await (await api("/api/push")).json()) as { publicKey: string };
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  return (await post("/api/push/subscribe", { subscription: sub.toJSON(), prefs })).prefs as PushPrefs;
}

export async function setPrefs(prefs: PushPrefs): Promise<PushPrefs> {
  const sub = await currentSubscription();
  if (!sub) throw new Error("not subscribed");
  return (await post("/api/push/subscribe", { subscription: sub.toJSON(), prefs })).prefs as PushPrefs;
}

export async function disable() {
  const sub = await currentSubscription();
  if (!sub) return;
  await post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
  await (navigator as { clearAppBadge?: () => Promise<void> }).clearAppBadge?.().catch(() => {});
}

export async function sendTest() {
  const sub = await currentSubscription();
  if (!sub) throw new Error("not subscribed");
  await post("/api/push/test", { endpoint: sub.endpoint });
}

/** At startup: the service worker, the subscription's workspace, and the badge while open. */
export function startPush() {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("service worker:", err));
  if (pushSupport() === "ok") void refresh().catch(() => {});

  const nav = navigator as { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (!nav.setAppBadge) return;
  let shown = -1;
  const badge = () => {
    const snap = sync.getSnapshot();
    if (!snap.loaded) return;
    const n = openSessions(snap.view).length;
    if (n === shown) return;
    shown = n;
    void (n ? nav.setAppBadge!(n) : nav.clearAppBadge!()).catch(() => {});
  };
  sync.subscribe(badge);
  badge();
}
