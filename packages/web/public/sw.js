// sideshow's service worker: notifications only (DESIGN.md §7, "Notifications"). No fetch
// handler, so it never caches or changes how the app loads. The server pushes what's running
// (server/src/push.ts, PushPayload); this words it in the device's own time zone, sets the
// app icon's badge, and opens the app when the notification is tapped.

const TAG = "sideshow-running";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// The app icon's badge. Clearing it only when one was set: on Windows, Chrome fills the icon's
// overlay with the profile picture whenever a badge is cleared (when it has several profiles).
// The flag is shared with the page (web/src/push.ts, setBadge) through Cache Storage.
const BADGE_CACHE = "sideshow-badge";
const BADGE_KEY = "/badge-set";
async function setBadge(count) {
  if (!self.navigator.setAppBadge) return;
  const cache = await caches.open(BADGE_CACHE);
  if (count) {
    await self.navigator.setAppBadge(count);
    await cache.put(BADGE_KEY, new Response("1"));
  } else if (await cache.match(BADGE_KEY)) {
    await self.navigator.clearAppBadge();
    await cache.delete(BADGE_KEY);
  }
}

const hm = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function duration(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h}h ${String(min % 60).padStart(2, "0")}m` : `${min}m`;
}

/** The notification for a push: [title, body]. */
function words(p) {
  const now = Date.now();
  const r = p.running || [];
  if (p.kind === "reminder" && r.length) {
    const longest = r.reduce((a, b) => (a.start < b.start ? a : b));
    return [`Still running: ${longest.title}`, `${duration(now - longest.start)} so far, since ${hm(longest.start)}` + (r.length > 1 ? ` (+${r.length - 1} more running)` : "")];
  }
  if (p.kind === "test") {
    return ["Notifications are on", r.length ? r.map((x) => `▶ ${x.title} · since ${hm(x.start)}`).join("\n") : "Nothing is running. When something is, it shows here."];
  }
  if (r.length === 1) return [`▶ ${r[0].title}`, `Since ${hm(r[0].start)}`];
  if (r.length > 1) return [`▶ ${r.length} running`, r.map((x) => `${x.title} · since ${hm(x.start)}`).join("\n")];
  if (p.paused && p.paused.length) return ["⏸ Paused", p.paused.join(", ")];
  return ["Nothing running", p.stopped && p.stopped.length ? `Stopped: ${p.stopped.join(", ")}` : ""];
}

self.addEventListener("push", (e) => {
  let p;
  try {
    p = e.data ? e.data.json() : null;
  } catch {
    p = null;
  }
  if (!p) return;
  const [title, body] = words(p);
  const count = (p.running || []).length;
  e.waitUntil(
    (async () => {
      // Badging: on an iPhone, a Home Screen app with notifications allowed.
      try {
        await setBadge(count);
      } catch {
        /* no badges here */
      }
      // One notification at a time: the new one replaces the last (where the tag alone doesn't).
      try {
        for (const n of await self.registration.getNotifications({ tag: TAG })) n.close();
      } catch {
        /* can't list them here */
      }
      await self.registration.showNotification(title, {
        body,
        tag: TAG,
        renotify: true,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        timestamp: Date.now(),
        data: { url: "/" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = all.find((c) => "focus" in c);
      if (open) return open.focus();
      return self.clients.openWindow("/");
    })(),
  );
});
