import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { useLayoutEffect, useRef } from "react";
import { noteExtensions, parseNote, serializeNote } from "../markdown";
import { linkTitle, openLink } from "../links";
import { showPicture } from "./Lightbox";
import { showToast } from "../toast";
import { upload } from "../uploads";

// A notes field that shows formatting as you type and stores Markdown (markdown.ts), with a
// toolbar like CW's: B / I / U, bullets, numbers, link, attach a file, add a picture. A
// screenshot pasted (or a file dropped) is uploaded and lands where the cursor is.
//
// Like DraftTextarea, it keeps its own text while focused, so a change arriving from another
// device never yanks text from under the cursor; and switching to another record (resetKey)
// replaces the text before the next keystroke can land in the old one.

export function RichNotes({
  value,
  onValue,
  resetKey,
  placeholder,
  label,
  className = "",
  editorRef,
  toolbar = "always",
}: {
  value: string;
  onValue: (markdown: string) => void;
  resetKey?: unknown;
  placeholder: string;
  /** The field's accessible name. */
  label: string;
  className?: string;
  /** Gets the editable element, for focusing it (the running card's notes). */
  editorRef?: React.RefObject<HTMLElement | null>;
  /** "focus": the toolbar only shows while the field has focus (the phone's running card). */
  toolbar?: "always" | "focus";
}) {
  const onValueRef = useRef(onValue);
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  // The Markdown the editor last showed or sent, so an echo of our own change isn't re-applied.
  const last = useRef(value);
  const keyRef = useRef(resetKey);
  const self = useRef<Editor | null>(null);

  const attach = (files: FileList | File[] | null | undefined) => {
    const list = [...(files ?? [])];
    const ed = self.current;
    if (!list.length || !ed) return false;
    for (const file of list) {
      showToast(`Uploading ${file.name || "screenshot"}…`);
      upload(file).then(
        (u) => {
          const chain = ed.chain().focus();
          if (u.type.startsWith("image/")) chain.setImage({ src: u.url, alt: u.name }).run();
          else chain.insertContent([{ type: "text", text: u.name, marks: [{ type: "link", attrs: { href: u.url } }] }, { type: "text", text: " " }]).run();
          showToast(`Attached ${u.name}`);
        },
        (err: Error) => showToast(err.message),
      );
    }
    return true;
  };

  // Ctrl+click on a link or picture, or a double click on a picture: a link opens in a new tab,
  // a picture over the page.
  const open = (event: MouseEvent) => {
    const el = (event.target as HTMLElement).closest("a, img");
    const href = el instanceof HTMLAnchorElement ? el.getAttribute("href") : el instanceof HTMLImageElement ? el.getAttribute("src") : null;
    if (!href) return false;
    event.preventDefault();
    if (el instanceof HTMLImageElement) showPicture(href, el.getAttribute("alt") ?? "");
    else openLink(href);
    return true;
  };

  const editor = useEditor({
    extensions: [...noteExtensions(), Placeholder.configure({ placeholder: () => placeholderRef.current })],
    content: parseNote(value),
    editorProps: {
      attributes: { class: "rich-content", "aria-label": label, role: "textbox", "aria-multiline": "true" },
      handlePaste: (_view, event) => attach(event.clipboardData?.files),
      handleDrop: (_view, event) => attach((event as DragEvent).dataTransfer?.files),
      // A click edits (puts the cursor in the link's text, selects a picture); Ctrl+click (⌘ on
      // a Mac) opens a link, and it or a double click shows a picture over the page. Hovering
      // says which, and where the link goes.
      handleClick: (_view, _pos, event) => {
        if (!(event.ctrlKey || event.metaKey)) return false;
        return open(event);
      },
      handleDoubleClick: (_view, _pos, event) => (event.target instanceof HTMLImageElement ? open(event) : false),
      handleDOMEvents: {
        mouseover: (_view, event) => {
          const el = (event.target as HTMLElement).closest("a, img");
          if (el instanceof HTMLAnchorElement) el.title = `${linkTitle(el.getAttribute("href") ?? "")}\nCtrl+click to open`;
          if (el instanceof HTMLImageElement) el.title = `${linkTitle(el.getAttribute("src") ?? "")}\nDouble-click or Ctrl+click to view`;
          return false;
        },
      },
    },
    onUpdate: ({ editor }) => {
      const md = serializeNote(editor.getJSON());
      if (md === last.current) return;
      last.current = md;
      onValueRef.current(md);
    },
  });
  self.current = editor;

  // Before paint: another record → its text (always); a change from elsewhere → shown unless
  // you're typing here. The handler switches with the text, so nothing lands in the old record.
  useLayoutEffect(() => {
    if (!editor) return;
    const switched = keyRef.current !== resetKey;
    keyRef.current = resetKey;
    onValueRef.current = onValue;
    if (editorRef) editorRef.current = editor.view.dom;
    if (value === last.current && !switched) return;
    if (!switched && editor.isFocused) return;
    last.current = value;
    editor.commands.setContent(parseNote(value), { emitUpdate: false });
  });

  return (
    <div className={`rich ${toolbar === "focus" ? "toolbar-on-focus" : ""} ${className}`}>
      {editor && <Toolbar editor={editor} onFiles={attach} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, onFiles }: { editor: Editor; onFiles: (files: FileList | null) => void }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      link: e.isActive("link"),
    }),
  });
  const files = useRef<HTMLInputElement>(null);
  const images = useRef<HTMLInputElement>(null);

  const link = () => {
    if (on.link) return editor.chain().focus().extendMarkRange("link").unsetLink().run();
    const href = window.prompt("Link to (a web address)")?.trim();
    if (!href) return editor.commands.focus();
    const url = /^[a-z]+:/i.test(href) ? href : `https://${href}`;
    if (editor.state.selection.empty) {
      editor.chain().focus().insertContent([{ type: "text", text: href, marks: [{ type: "link", attrs: { href: url } }] }, { type: "text", text: " " }]).run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  };

  const button = (label: string, pressed: boolean | undefined, run: () => void, icon: React.ReactNode, key?: string) => (
    <button
      type="button"
      className="rich-btn"
      aria-label={label}
      aria-pressed={pressed}
      title={key ? `${label} (${key})` : label}
      // Keep the cursor in the note: a toolbar click mustn't take focus.
      onPointerDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );

  return (
    <div className="rich-toolbar" role="toolbar" aria-label="Formatting">
      {button("Bold", on.bold, () => editor.chain().focus().toggleBold().run(), <b>B</b>, "Ctrl+B")}
      {button("Italic", on.italic, () => editor.chain().focus().toggleItalic().run(), <i>I</i>, "Ctrl+I")}
      {button("Underline", on.underline, () => editor.chain().focus().toggleUnderline().run(), <u>U</u>, "Ctrl+U")}
      <span className="rich-sep" aria-hidden />
      {button("Bulleted list", on.bullets, () => editor.chain().focus().toggleBulletList().run(), <BulletsIcon />)}
      {button("Numbered list", on.numbers, () => editor.chain().focus().toggleOrderedList().run(), <NumbersIcon />)}
      <span className="rich-sep" aria-hidden />
      {button("Attach a file", undefined, () => files.current?.click(), <ClipIcon />)}
      {button(on.link ? "Remove link" : "Add a link", on.link, link, <LinkIcon />)}
      {button("Add a picture", undefined, () => images.current?.click(), <ImageIcon />)}
      <input
        ref={files}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={images}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const icon = (path: React.ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {path}
  </svg>
);
const BulletsIcon = () =>
  icon(
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" />
    </>,
  );
const NumbersIcon = () =>
  icon(
    <>
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M4 5h1.5v4M4 9h3M4 14.5c0-.8.7-1.5 1.5-1.5s1.5.6 1.5 1.3c0 1.2-3 1.9-3 3.7h3" strokeWidth="1.5" />
    </>,
  );
const ClipIcon = () => icon(<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />);
const LinkIcon = () =>
  icon(
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>,
  );
const ImageIcon = () =>
  icon(
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>,
  );
