// Light, dark, or the system's setting. It's chosen per device (the phone may follow the
// system while the desktop stays dark), so it lives in localStorage, not in synced settings.
// The resolved theme goes on <html data-theme>, which styles.css keys its colors on.
// index.html sets it once before the first paint (same key and rule), so nothing flashes.

export type ThemePref = "system" | "light" | "dark";

const KEY = "sideshow:theme";
const BG = { light: "#f4f5f7", dark: "#0e1116" }; // --bg in styles.css
const dark = window.matchMedia("(prefers-color-scheme: dark)");

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // Storage blocked: follow the system.
  }
  return "system";
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage blocked: it still applies until the page reloads.
  }
  applyTheme(pref);
}

function applyTheme(pref = themePref()) {
  const theme = pref === "system" ? (dark.matches ? "dark" : "light") : pref;
  document.documentElement.dataset.theme = theme;
  // The browser / iPhone status bar color.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", BG[theme]);
}

/** Apply the saved theme and keep following the system while that's the choice. */
export function startTheme() {
  applyTheme();
  dark.addEventListener("change", () => applyTheme());
}
