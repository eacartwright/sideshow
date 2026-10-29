import type { Id } from "@sideshow/shared";

// Dev notes (DESIGN.md §7): ideas and bugs about sideshow itself, one list for the whole server
// (not per workspace). The server keeps them, not the synced state; the dialog asks for them each
// time it opens. Types are the server's (server/src/devnotes.ts).

export interface DevNoteFile {
  id: string;
  name: string;
  type: string;
}

export interface DevNote {
  id: string;
  text: string;
  createdAt: number;
  done: boolean;
  /** Where it was written; a task can be opened again. */
  page: DevNotePage | null;
  files: DevNoteFile[];
  deleted: boolean;
}

export interface DevNotePage {
  label: string;
  taskId?: Id;
}

/** The notes as they are after the request, or why it didn't work. */
type Answer = { notes?: DevNote[]; error?: string };

async function call(method: string, path: string, body?: unknown): Promise<Answer> {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) return { error: "Signed out: reload to sign in, then try again." };
    const b = (await res.json().catch(() => ({}))) as Answer;
    return res.ok ? b : { error: b.error ?? "Something went wrong on the server." };
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

export const loadDevNotes = () => call("GET", "/api/devnotes");
export const addDevNote = (text: string, page: DevNotePage | null, files: DevNoteFile[]) => call("POST", "/api/devnotes", { text, page, files });
export const updateDevNote = (id: string, patch: { text?: string; done?: boolean; files?: DevNoteFile[]; deleted?: boolean }) =>
  call("POST", `/api/devnotes/${id}`, patch);

/** The open notes as a Markdown list, for pasting into a work session. */
export function devNotesMarkdown(notes: DevNote[]): string {
  const day = (t: number) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
  return notes.map((n) => `- ${n.text.replace(/\n/g, "\n  ")} (${n.page ? `${n.page.label}, ` : ""}${day(n.createdAt)})`).join("\n");
}
