// Font tester (Settings › Experimental). Loads a Google Font on demand and applies it to the
// header ("sideshow") or the whole app, per device, over the defaults in styles.css / index.html
// (Unbounded and Bricolage Grotesque, 2026-10-12).

export const FONTS = [
  "Google Sans Flex",
  "Google Sans",
  "Roboto",
  "Roboto Condensed",
  "Montserrat",
  "Prompt",
  "Bricolage Grotesque",
  "Lato",
  "Arimo",
  "Inter",
  "Palanquin Dark",
  "Kripa",
  "DM Sans",
  "Poppins",
  "Unbounded",
  "Fira Sans Condensed",
];

export type FontSlot = "app" | "header";
const KEY: Record<FontSlot, string> = { app: "sideshow:font-app", header: "sideshow:font-header" };
const VAR: Record<FontSlot, string> = { app: "--font", header: "--font-brand" };
const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Whether each font loaded: true, false (Google Fonts doesn't have it), or absent (not tried). */
export const loaded = new Map<string, boolean>();
const loading = new Map<string, Promise<boolean>>();

/** Fetch a Google Font's stylesheet. Asks for the weights the app uses, then fewer if it lacks some. */
function load(family: string): Promise<boolean> {
  const existing = loading.get(family);
  if (existing) return existing;
  const name = family.replace(/ /g, "+");
  const tries = [`${name}:wght@400;600;700;800`, `${name}:wght@400;700`, name];
  const attempt = (i: number): Promise<boolean> =>
    new Promise((resolve) => {
      if (i >= tries.length) return resolve(false);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${tries[i]}&display=swap`;
      link.onload = () => resolve(true);
      link.onerror = () => {
        link.remove();
        resolve(attempt(i + 1));
      };
      document.head.append(link);
    });
  const p = attempt(0).then((ok) => {
    loaded.set(family, ok);
    return ok;
  });
  loading.set(family, p);
  return p;
}

export function fontChoice(slot: FontSlot): string {
  try {
    return localStorage.getItem(KEY[slot]) ?? "";
  } catch {
    return "";
  }
}

/** Use `family` ("" = the default) for a slot, now and on this device's next visits. */
export async function setFont(slot: FontSlot, family: string): Promise<boolean> {
  try {
    if (family) localStorage.setItem(KEY[slot], family);
    else localStorage.removeItem(KEY[slot]);
  } catch {
    // Storage blocked: applies until reload.
  }
  return apply(slot, family);
}

async function apply(slot: FontSlot, family: string): Promise<boolean> {
  const root = document.documentElement.style;
  if (!family) {
    root.removeProperty(VAR[slot]);
    return true;
  }
  // The device's own font: nothing to load.
  if (family === "system-ui") {
    root.setProperty(VAR[slot], SYSTEM);
    return true;
  }
  const ok = await load(family);
  // Still the choice once loaded? (Arrowing through the list fires many of these.)
  if (fontChoice(slot) === family) root.setProperty(VAR[slot], ok ? `"${family}", ${SYSTEM}` : SYSTEM);
  return ok;
}

export function startFonts() {
  for (const slot of ["app", "header"] as FontSlot[]) {
    const family = fontChoice(slot);
    if (family) void apply(slot, family);
  }
}
