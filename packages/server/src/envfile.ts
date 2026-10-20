import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

// Changing settings in the server's .env from the app (Settings › Connections). Only the keys
// given are touched: each one's line is replaced where it is (or added at the end), comments and
// every other line stay as they were. The file before the change is kept as .env.bak.

/** The text of an .env file with `values` set. */
export function withValues(text: string, values: Record<string, string>): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : [];
  const left = new Map(Object.entries(values));
  for (let i = 0; i < lines.length; i++) {
    const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(lines[i]!)?.[1];
    if (key && left.has(key)) {
      lines[i] = `${key}=${left.get(key)}`;
      left.delete(key);
    }
  }
  // A trailing newline leaves an empty last line: add before it.
  const end = lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  lines.splice(end, 0, ...[...left].map(([k, v]) => `${k}=${v}`));
  if (lines[lines.length - 1] !== "") lines.push("");
  return lines.join(eol);
}

/** A value .env can hold as is: one line, no quotes or comment marks to misread. */
export function envSafe(v: string): boolean {
  return !/[\r\n"'#]/.test(v) && v === v.trim();
}

export function updateEnvFile(file: string, values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) if (!envSafe(v)) throw new Error(`${k}: not a value .env can hold`);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, withValues(text, values));
  renameSync(tmp, file);
}
