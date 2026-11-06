// Tells the server when something breaks in this tab (server: clienterrors.ts), so it can be read
// later instead of being lost with the tab. Reporting must never cause trouble of its own: it sends
// each error once, stops after a few, and ignores its own failures. Goes straight to fetch, not
// api(): the server's list isn't per workspace, and a signed-out answer is nothing to act on.

declare const __BUILD__: string;

const MAX_PER_LOAD = 20;
const sent = new Set<string>();

/** Not bugs: the browser's own noise, and requests that failed because the network or login did. */
const IGNORED = /ResizeObserver loop|^Script error\.?$|^Failed to fetch$|^NetworkError|^Load failed$|^The operation was aborted|^AbortError/;

export function reportClientError(source: string, err: unknown, extraStack = "") {
  if (typeof location === "undefined") return; // Tests run without a browser.
  const error = err instanceof Error ? err : new Error(String(err));
  if (error.name === "SignedOut" || IGNORED.test(error.message)) return;
  const key = `${source}|${error.message}`;
  if (sent.has(key) || sent.size >= MAX_PER_LOAD) return;
  sent.add(key);
  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      source,
      message: error.message,
      stack: `${error.stack ?? ""}${extraStack ? `\n\nReact:${extraStack}` : ""}`.slice(0, 8000),
      page: location.pathname + location.hash,
      build: typeof __BUILD__ === "string" ? __BUILD__ : "",
      device: navigator.userAgent,
    }),
  }).catch(() => {});
}

/** Errors nothing caught. Ones thrown while rendering come through ErrorBoundary instead. */
export function startErrorLog() {
  window.addEventListener("error", (e) => reportClientError("error", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reportClientError("promise", e.reason));
}
