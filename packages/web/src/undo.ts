import { undoOps, type Op, type OpEnvelope, type State } from "@sideshow/shared";
import { useSyncExternalStore } from "react";
import { sync } from "./sync";
import { showToast } from "./toast";

// Undo for this device's own changes (DESIGN.md §7, "Undo"). An undoable action records the
// ops it sends and the state before them; undoing works out the ops that put things back
// (undoOps in shared). In memory only: a reload starts a fresh history.
// Not undoable: typing (the text box has its own Ctrl+Z), starting and stopping the clock,
// and anything sent to ConnectWise.

interface Entry {
  label: string;
  before: State;
  ops: OpEnvelope[];
  /** Changes with the same key in quick succession (a time typed digit by digit) undo as one. */
  key?: string;
  at: number;
}

const LIMIT = 50;
const COALESCE_MS = 4000;
let stack: Entry[] = [];
let recording: Entry | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** sync.dispatch, recorded for undo when inside `undoable`. */
export function send(op: Op, flushDelay = 0): OpEnvelope {
  const env = sync.dispatch(op, flushDelay);
  recording?.ops.push(env);
  return env;
}

/**
 * Run `fn` (which sends ops with `send`) as one undoable step. With `toast`, a message with an
 * Undo button follows. Returns what `fn` does.
 */
export function undoable<T>(label: string, fn: () => T, opts: { key?: string; toast?: string } = {}): T {
  if (recording) return fn(); // already inside one: part of it
  const top = stack[stack.length - 1];
  const joined = !!opts.key && top?.key === opts.key && Date.now() - top.at < COALESCE_MS;
  const entry: Entry = joined ? top! : { label, before: sync.getSnapshot().view, ops: [], key: opts.key, at: Date.now() };
  recording = entry;
  try {
    return fn();
  } finally {
    recording = null;
    entry.at = Date.now();
    if (!joined && entry.ops.length) {
      stack = [...stack.slice(-(LIMIT - 1)), entry];
      emit();
    }
    if (opts.toast && entry.ops.length) showToast(opts.toast, { label: "Undo", run: () => undoEntry(entry) });
  }
}

function undoEntry(entry: Entry): boolean {
  if (!stack.includes(entry)) return false;
  stack = stack.filter((e) => e !== entry);
  emit();
  const ops = undoOps(entry.before, entry.ops, Date.now());
  for (const op of ops) sync.dispatch(op);
  return ops.length > 0;
}

/** Undo the latest step (Ctrl+Z). */
export function undo() {
  const entry = stack[stack.length - 1];
  if (!entry) {
    showToast("Nothing to undo");
    return;
  }
  undoEntry(entry);
  showToast(`Undone: ${entry.label}`);
}

/** What Undo would undo, or null. */
export function useUndoLabel(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => stack[stack.length - 1]?.label ?? null,
  );
}
