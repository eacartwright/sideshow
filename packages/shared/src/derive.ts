import { liveSessions } from "./reducer";
import type { Id, Ms, Project, Session, State, Task } from "./types";

// Read-only views over State. Nothing here is stored.

export const MINUTE = 60_000;

export function sessionsByTask(state: State): Map<Id, Session[]> {
  const map = new Map<Id, Session[]>();
  for (const s of liveSessions(state)) {
    const list = map.get(s.taskId);
    if (list) list.push(s);
    else map.set(s.taskId, [s]);
  }
  for (const list of map.values()) list.sort((a, b) => a.start - b.start);
  return map;
}

export function durationMs(s: Session, now: Ms): Ms {
  return Math.max(0, (s.end ?? now) - s.start - s.deductMin * MINUTE);
}

/** First meaningful line of some notes, without list/heading markers. */
export function firstLine(notes: string, max = 80): string {
  for (const raw of plainNote(notes).split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:(?:[-*•>]|#+|\d+[.)]|\[[ xX]\])\s*)*/, "").trim();
    if (line) return line.length > max ? `${line.slice(0, max - 1)}…` : line;
  }
  return "";
}

/**
 * A note's Markdown as plain text (DESIGN.md §5): formatting marks dropped, a link as its text,
 * an image or attached file as its name in brackets ("[screenshot.png]"), escapes like "\(" undone.
 * Lines and list markers stay.
 */
export function plainNote(markdown: string): string {
  const fileName = (src: string) => {
    try {
      return decodeURIComponent(src.split("/").pop() ?? "");
    } catch {
      return "";
    }
  };
  return markdown
    .replace(/!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_m, alt: string, src: string) => `[${alt || fileName(src) || "image"}]`)
    .replace(/\[([^\]]+)\]\(([^)\s]*)[^)]*\)/g, (_m, text: string, href: string) => (href.startsWith("/api/files/") ? `[${text}]` : text))
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\+\+(.+?)\+\+/g, "$1")
    .replace(/(^|[^*\w])\*(?![\s*])(.+?)\*(?!\w)/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1");
}

/**
 * What to call a task. Its own title if set, otherwise the first line of its
 * earliest notes, otherwise "Untitled · 10:42".
 */
export function displayTitle(task: Task, sessions: Session[] = []): { text: string; derived: boolean } {
  if (task.title.trim()) return { text: task.title.trim(), derived: false };
  for (const s of sessions) {
    const line = firstLine(s.notes);
    if (line) return { text: line, derived: true };
  }
  const when = new Date(sessions[0]?.start ?? task.createdAt);
  const hm = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return { text: `Untitled · ${hm}`, derived: true };
}

/** A ref as typed ("#12345 ", "12345") reduced to the ticket number; "" if it isn't one. */
export function ticketNumber(ref: string): string {
  const n = ref.trim().replace(/^#+/, "").trim();
  return /^\d+$/.test(n) ? n : "";
}

/** A project and the projects it sits in, outermost first. Empty for no project. */
export function projectPath(state: State, id: Id | null | undefined): Project[] {
  const path: Project[] = [];
  for (let p = id ? state.projects[id] : undefined; p && !path.includes(p); p = p.parentId ? state.projects[p.parentId] : undefined) {
    path.unshift(p);
  }
  return path;
}

/** Projects in tree order (each followed by its subprojects, by title), with their depth. */
export function projectTree(projects: Project[]): { project: Project; depth: number }[] {
  const ids = new Set(projects.map((p) => p.id));
  const children = new Map<Id | null, Project[]>();
  for (const p of projects) {
    // A project whose parent isn't in the list (archived, say) shows at the top level.
    const parent = p.parentId && ids.has(p.parentId) ? p.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), p]);
  }
  const out: { project: Project; depth: number }[] = [];
  const walk = (parent: Id | null, depth: number) => {
    for (const p of (children.get(parent) ?? []).sort((a, b) => a.title.localeCompare(b.title))) {
      out.push({ project: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Recency for sorting: the last time the task was started, or when it was created. */
export function lastTouchedAt(task: Task, sessions: Session[] = []): Ms {
  const last = sessions[sessions.length - 1];
  return Math.max(task.createdAt, last?.start ?? 0);
}

export function isInbox(task: Task, sessions: Session[] = []): boolean {
  return task.status === "open" && sessions.length === 0;
}

export function startOfDay(t: Ms): Ms {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Milliseconds of a session that fall within [from, to). */
export function overlapMs(s: Session, from: Ms, to: Ms, now: Ms): Ms {
  const a = Math.max(s.start, from);
  const b = Math.min(s.end ?? now, to);
  return Math.max(0, b - a);
}

/** Every whitespace-separated term must appear somewhere in the haystack. */
export function matchesQuery(haystack: string, query: string): boolean {
  const h = haystack.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => h.includes(term));
}
