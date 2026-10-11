import type { Fields, FieldValue } from "./types";

// A profile declares the extra fields a job needs (DESIGN.md §4). A field the profile
// doesn't list doesn't exist. One profile is active at a time; the server loads it from
// packages/server/profiles/<PROFILE>.json and hands it to the app with the state.

export type FieldType = "text" | "choice" | "list" | "bool";

export interface FieldDef {
  /** Where the value is stored in a task's or session's `fields`. Never reuse a key for something else. */
  key: string;
  label: string;
  on: "task" | "session";
  type: FieldType;
  /** `list`: which list its items come from (ListItem.list). */
  list?: string;
  /**
   * How it's edited. `list`: "search" for a find-or-add box (long lists), "select" for a
   * dropdown (the default). `choice`: "select" (the default) or "segmented", a row of buttons.
   */
  input?: "select" | "search" | "segmented";
  /** `choice`: the fixed options. */
  options?: string[];
  /** `choice`: a short label per option, in the same order ("B" for Billable), for compact controls. */
  short?: string[];
  /** A `list` field that gets its own filter chips (and later a sidebar view and page). */
  groupBy?: boolean;
  /** Put in front of the value when shown ("#" for a ticket number). */
  prefix?: string;
  /** The value when none is set: shown as chosen, and used as such ("Internal" for where notes go). */
  default?: FieldValue;
}

/** A list entry in the profile: a name, optionally with the values it fills in when chosen. */
export type ProfileListEntry = string | { name: string; defaults?: Fields };

export interface EntryFormat {
  /** Where the entries go, for wording ("Update the entry in ConnectWise"). */
  target?: string;
  date: "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
  time: "h:mm A" | "HH:mm";
  hours: "decimal" | "h:mm";
  /**
   * What the Time entries sheet shows and copies, in order. Field keys, plus the built-ins
   * date, start, end, hours and notes. Task fields show once per task, the rest per entry.
   */
  fields: string[];
}

export interface Profile {
  name: string;
  fields: FieldDef[];
  /** Starting contents of each list, used when the list is empty (and for item defaults). */
  lists?: Record<string, ProfileListEntry[]>;
  entryFormat?: EntryFormat;
  /** The ConnectWise integration: which fields it reads and fills. */
  connectwise?: {
    ticketField: string;
    clientField?: string;
    /** For pushing time entries (session fields). Work type items match CW work types by name. */
    workTypeField?: string;
    /** Values are CW's billing names: Billable, Do Not Bill, No Charge. */
    billingField?: string;
    /** Values: Internal or Discussion (where the entry's notes show on the ticket). */
    noteToField?: string;
  };
}

export const NO_PROFILE: Profile = { name: "None", fields: [] };

export const ENTRY_BUILTINS = ["date", "start", "end", "hours", "notes"] as const;

export const DEFAULT_ENTRY_FORMAT: EntryFormat = {
  date: "MM/DD/YYYY",
  time: "h:mm A",
  hours: "decimal",
  fields: ["date", "start", "end", "hours", "notes"],
};

/** Problems with a profile, or an empty list if it's usable. */
export function profileProblems(p: Profile): string[] {
  const out: string[] = [];
  if (!p || typeof p.name !== "string" || !Array.isArray(p.fields)) return ["needs a name and a fields list"];
  const keys = new Set<string>();
  for (const f of p.fields) {
    const at = `field "${f?.key}"`;
    if (!f || typeof f.key !== "string" || !f.key) out.push("a field without a key");
    else if (keys.has(f.key)) out.push(`${at} is listed twice`);
    else keys.add(f.key);
    if (f.on !== "task" && f.on !== "session") out.push(`${at}: "on" must be task or session`);
    if (!["text", "choice", "list", "bool"].includes(f.type)) out.push(`${at}: unknown type "${f.type}"`);
    if (f.type === "list" && !f.list) out.push(`${at}: a list field needs "list"`);
    if (f.type === "choice" && !f.options?.length) out.push(`${at}: a choice field needs "options"`);
    if (f.input === "search" && f.type !== "list") out.push(`${at}: "input": "search" is for list fields`);
    if (f.input === "segmented" && f.type !== "choice") out.push(`${at}: "input": "segmented" is for choice fields`);
    if (f.short && f.short.length !== f.options?.length) out.push(`${at}: "short" needs one label per option`);
    if (f.default !== undefined && f.type === "choice" && !f.options?.includes(String(f.default)))
      out.push(`${at}: default "${f.default}" isn't one of its options`);
  }
  for (const [list, entries] of Object.entries(p.lists ?? {})) {
    for (const e of entries) {
      const { name, defaults } = listEntry(e);
      for (const [k, v] of Object.entries(defaults ?? {})) {
        const f = p.fields.find((x) => x.key === k);
        if (!f) out.push(`lists.${list} "${name}": default for unknown field "${k}"`);
        else if (f.type === "choice" && !f.options?.includes(String(v))) out.push(`lists.${list} "${name}": "${v}" isn't one of ${f.key}'s options`);
      }
    }
  }
  for (const k of p.entryFormat?.fields ?? []) {
    if (!keys.has(k) && !(ENTRY_BUILTINS as readonly string[]).includes(k)) out.push(`entryFormat: unknown field "${k}"`);
  }
  const cw = p.connectwise;
  if (cw && !keys.has(cw.ticketField)) out.push(`connectwise.ticketField "${cw.ticketField}" isn't a field`);
  for (const k of ["clientField", "workTypeField", "billingField", "noteToField"] as const) {
    if (cw?.[k] && !keys.has(cw[k])) out.push(`connectwise.${k} "${cw[k]}" isn't a field`);
  }
  return out;
}

/** A list entry's name and defaults, whichever way it was written. */
export function listEntry(e: ProfileListEntry): { name: string; defaults?: Fields } {
  return typeof e === "string" ? { name: e } : e;
}

/** The id a seeded list item gets: its name as a slug, so seeding is the same everywhere. */
export function slugId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
