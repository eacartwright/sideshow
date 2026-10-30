import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTemplates } from "./aiTemplates";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function folder(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-tpl-"));
  dirs.push(dir);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  return dir;
}

describe("AI templates from files", () => {
  it("reads the real folder", () => {
    const t = loadTemplates();
    expect(t.rules).toContain('"* " bullets');
    expect(t.templates.map((x) => x.id)).toEqual(["communication-actions-next", "cleanup"]);
    expect(t.templates[0]!.name).toBe("Communication / Actions Taken / Next Steps");
  });

  it("orders by number, takes the name from the heading, and drops comments", () => {
    const dir = folder({
      "rules.md": "<!-- a note to self -->\r\nRules.\r\n",
      "10-later.md": "# Later\nTen.",
      "2-first.md": "<!-- why this one -->\n# First one\n\nLine one.\n<!-- more\nnotes -->\nLine two.\n",
      "README.md": "Not a template.",
      "notes.txt": "Nor this.",
    });
    expect(loadTemplates(dir)).toEqual({
      rules: "Rules.",
      templates: [
        { id: "first", name: "First one", instructions: "Line one.\n\nLine two." },
        { id: "later", name: "Later", instructions: "Ten." },
      ],
    });
  });

  it("says which file is wrong", () => {
    expect(() => loadTemplates(folder({ "1-a.md": "# A\nB" }))).toThrow("ai-templates/rules.md is missing or empty");
    expect(() => loadTemplates(folder({ "rules.md": "R" }))).toThrow("No templates");
    expect(() => loadTemplates(folder({ "rules.md": "R", "1-a.md": "# A\n" }))).toThrow("ai-templates/1-a.md: the first line");
    expect(() => loadTemplates(folder({ "rules.md": "R", "1-a.md": "# A\nB", "2-a.md": "# A2\nC" }))).toThrow('another file is also "a"');
    expect(() => loadTemplates(join(tmpdir(), "no-such-sideshow-folder"))).toThrow("No templates folder");
  });
});
