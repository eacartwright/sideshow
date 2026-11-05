import type { Id, Session } from "@sideshow/shared";
import { showToast } from "./toast";
import { send } from "./undo";

// Where an entry started and ended (DESIGN.md §7), to answer "when did I leave, and where was I?"
// without Google Timeline. A stamp is taken when a timer starts or stops on this device and kept
// in session.ext.geo; nothing follows you in between (a web app can't read the location while
// it's closed). Per device, because it's the phone's location that means anything.

export type LocationMode = "off" | "travel" | "all";
const KEY = "sideshow:location";

export function locationMode(): LocationMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "off" || v === "all" || v === "travel") return v;
  } catch {
    // Not stored: the default.
  }
  return "travel";
}
export function setLocationMode(mode: LocationMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Not remembered; fine for this visit.
  }
}
export const wantsLocation = (travel: boolean) => {
  const mode = locationMode();
  return mode === "all" || (mode === "travel" && travel);
};

let warned = false;

/** Stamp the session with where this device is now. Best effort: it never holds up the timer. */
export function recordLocation(sessionId: Id, which: "start" | "end") {
  if (!("geolocation" in navigator)) return;
  const at = Date.now();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const round = (n: number) => Math.round(n * 100_000) / 100_000;
      send({
        type: "session.update",
        sessionId,
        patch: {
          ext: {
            geo: {
              [`${which}Lat`]: round(pos.coords.latitude),
              [`${which}Lon`]: round(pos.coords.longitude),
              [`${which}Acc`]: Math.round(pos.coords.accuracy),
              [`${which}At`]: at,
            },
          },
        },
      });
    },
    (err) => {
      if (warned || err.code !== err.PERMISSION_DENIED) return;
      warned = true;
      showToast("Location is blocked for this app, so this entry has none. Settings › General can turn this off.");
    },
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
  );
}

/** A location stamp on a session, if it has one. */
export function stampOf(s: Pick<Session, "ext">, which: "start" | "end") {
  const g = s.ext?.geo;
  const lat = g?.[`${which}Lat`];
  const lon = g?.[`${which}Lon`];
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return { lat, lon, acc: Number(g?.[`${which}Acc`] ?? 0), at: Number(g?.[`${which}At`] ?? 0) };
}
export const mapUrl = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
