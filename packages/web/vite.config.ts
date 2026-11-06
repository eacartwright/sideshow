import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/** The commit being built, for error reports. */
function buildId() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ mode }) => {
  // The server reads the repo-root .env, so the proxy follows its PORT too.
  const env = { ...loadEnv(mode, "../..", ""), ...process.env };
  return {
    plugins: [react()],
    define: { __BUILD__: JSON.stringify(buildId()) },
    // Maps sit beside the files but aren't linked from them: for reading an error report's stack.
    build: { sourcemap: "hidden" },
    // Keep the terminal's history (the URLs Vite prints at the start).
    clearScreen: false,
    server: {
      // Reachable from the phone on the LAN during development.
      host: true,
      port: 5173,
      proxy: {
        "/api": env.SIDESHOW_API ?? env.FIELDTIME_API ?? `http://localhost:${env.PORT ?? 8787}`,
      },
    },
  };
});
