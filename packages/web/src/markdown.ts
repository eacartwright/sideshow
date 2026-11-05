import { generateHTML, type AnyExtension, type JSONContent } from "@tiptap/core";
import HardBreak from "@tiptap/extension-hard-break";
import Image from "@tiptap/extension-image";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

// Notes are stored as Markdown (DESIGN.md §5), the flavor CW's own editor writes: **bold**,
// *italic*, lists, [links](…), ![images](…). The editor (RichNotes.tsx) shows it formatted;
// this module is what it and everything that reads notes agree on.
//
// Notes written before the editor are plain text, one thing per line. Markdown would run such
// lines together, so a single line break stays a line break both ways: read with `breaks`,
// written back as a bare "\n" (not Markdown's "two spaces + newline"). A plain note comes out
// exactly as it went in.

/** The editor's extensions, minus anything that needs a browser (tests and plain readers use these). */
export function noteExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      // The CW-style toolbar has no headings, code, quotes or rules, so notes don't either.
      heading: false,
      codeBlock: false,
      code: false,
      blockquote: false,
      horizontalRule: false,
      strike: false,
      hardBreak: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    HardBreak.extend({ renderMarkdown: () => "\n" }),
    Image.configure({ inline: false, allowBase64: false }),
  ];
}

export const MARKED_OPTIONS = { gfm: true, breaks: true };

let manager: MarkdownManager | null = null;
function md(): MarkdownManager {
  manager ??= new MarkdownManager({ extensions: noteExtensions(), markedOptions: MARKED_OPTIONS });
  return manager;
}

/**
 * Markdown → the editor's document. Empty notes parse to a document with nothing in it, so the
 * editor would open with no line: no placeholder (it sits on the first line) and no proper cursor.
 * They get one empty paragraph instead, which is what the editor has after deleting everything.
 */
export function parseNote(markdown: string): JSONContent {
  const doc = markdown.trim() ? md().parse(markdown) : null;
  return doc?.content?.length ? doc : { type: "doc", content: [{ type: "paragraph" }] };
}

/** The editor's document → Markdown, without trailing blank lines. */
export function serializeNote(doc: JSONContent): string {
  return md().serialize(doc).replace(/\s+$/, "");
}

/**
 * A picture in a note from outside the app (a CW note may hold a client's email) as a plain link:
 * it shows only if you ask, rather than loading from wherever it points as soon as it's on screen.
 */
export function withoutPictures(markdown: string): string {
  return markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_all, alt: string, url: string) => `[Picture${alt ? `: ${alt}` : ""}](${url})`);
}

const htmlCache = new Map<string, string>();

/**
 * A note as HTML, for showing it formatted but not editable (NoteView). Built by the editor's
 * own schema, so only what notes can hold gets through; links are checked (no javascript:).
 */
export function noteHtml(markdown: string): string {
  let html = htmlCache.get(markdown);
  if (html === undefined) {
    html = generateHTML(parseNote(markdown), noteExtensions());
    if (htmlCache.size > 500) htmlCache.clear();
    htmlCache.set(markdown, html);
  }
  return html;
}
