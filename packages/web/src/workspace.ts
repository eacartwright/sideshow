// Which workspace this device is in (DESIGN.md §4, Workspaces). Chosen per device in Settings and
// fixed for the page's life: switching reloads the app, so nothing from one workspace (its cached
// state, its unsent changes) can mix with another's. Every request says which (sync.ts, api()).

const KEY = "sideshow:workspace";
export const MAIN = "main";

function read(): string {
  try {
    return localStorage.getItem(KEY) || MAIN;
  } catch {
    return MAIN;
  }
}

/** This page's workspace. */
export const workspaceId: string = read();

/**
 * A localStorage key for this workspace's own data. The main workspace keeps the keys there
 * were before workspaces, so its cache and unsent changes carry on as they were.
 */
export const wsKey = (base: string) => (workspaceId === MAIN ? base : `${base}@${workspaceId}`);

/** Open another workspace: the app starts again in it. */
export function switchWorkspace(id: string) {
  try {
    if (id === MAIN) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
  } catch {
    return; // Can't remember it: staying put beats a reload that lands in the same place.
  }
  location.reload();
}

/** How many changes another workspace has waiting to be sent from this device. */
export function unsentIn(id: string): number {
  try {
    const raw = localStorage.getItem(id === MAIN ? "sideshow:pending" : `sideshow:pending@${id}`);
    return raw ? (JSON.parse(raw) as unknown[]).length : 0;
  } catch {
    return 0;
  }
}
