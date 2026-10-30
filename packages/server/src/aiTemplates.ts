import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiTemplate, AiTemplates } from "@sideshow/shared";

// The AI cleanup templates (DESIGN.md §11): Markdown files in packages/server/ai-templates/,
// read on every call so an edit shows on the next ✨ without a restart. rules.md goes with
// every template; each <number>-<id>.md is one, in number order, its first line "# Name".
// The folder's README.md says the same for whoever edits them.

export const TEMPLATES_DIR = fileURLToPath(new URL("../ai-templates/", import.meta.url));

/** A file's text without its <!-- comments -->, which are notes for whoever edits it. */
const strip = (text: string) => text.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").trim();

/** The templates and rules there; throws an Error saying which file is wrong. */
export function loadTemplates(dir = TEMPLATES_DIR): AiTemplates {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    throw new Error(`No templates folder (${dir})`);
  }
  const rules = files.includes("rules.md") ? strip(readFileSync(join(dir, "rules.md"), "utf8")) : "";
  if (!rules) throw new Error("ai-templates/rules.md is missing or empty");
  const templates: AiTemplate[] = [];
  for (const f of files.filter((x) => /^\d+-.+\.md$/.test(x)).sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b))) {
    const text = strip(readFileSync(join(dir, f), "utf8"));
    const m = /^# +(.+)\n([\s\S]*)$/.exec(text);
    const instructions = m?.[2]!.trim();
    if (!m || !instructions) throw new Error(`ai-templates/${f}: the first line is "# Its name", then the instructions`);
    const id = f.replace(/^\d+-/, "").replace(/\.md$/, "");
    if (templates.some((t) => t.id === id)) throw new Error(`ai-templates/${f}: another file is also "${id}"`);
    templates.push({ id, name: m[1]!.trim(), instructions });
  }
  if (!templates.length) throw new Error("No templates in ai-templates/ (01-<name>.md, …)");
  return { rules, templates };
}
