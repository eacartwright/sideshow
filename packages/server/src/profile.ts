import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  listEntry,
  NO_PROFILE,
  profileProblems,
  slugId,
  type Fields,
  type ListItem,
  type Ms,
  type Profile,
  type Session,
  type State,
  type Task,
} from "@sideshow/shared";

// The active profile (DESIGN.md §4): packages/server/profiles/<PROFILE>.json, chosen with
// PROFILE in .env. Without one, the app is a plain task and time tracker; values already
// stored in fields stay in the database, just hidden.

const DIR = new URL("../profiles/", import.meta.url);

export function loadProfile(name: string | undefined): Profile {
  if (!name) return NO_PROFILE;
  if (!/^[a-z0-9-]+$/i.test(name)) throw new Error(`PROFILE "${name}": use the file name without .json`);
  const file = fileURLToPath(new URL(`${name}.json`, DIR));
  const profile = JSON.parse(readFileSync(file, "utf8")) as Profile;
  const problems = profileProblems(profile);
  if (problems.length) throw new Error(`Profile ${file}: ${problems.join("; ")}`);
  return profile;
}

/** The profiles there are to choose from: file name (without .json) and the profile's own name. */
export function listProfiles(): { file: string; name: string }[] {
  const out: { file: string; name: string }[] = [];
  for (const f of readdirSync(fileURLToPath(DIR)).filter((x) => x.endsWith(".json")).sort()) {
    const file = f.slice(0, -5);
    try {
      out.push({ file, name: loadProfile(file).name });
    } catch {
      // A broken profile isn't offered; picking it would fail.
    }
  }
  return out;
}

/**
 * List items to write so the database matches the profile's lists: a list that has no items
 * yet is filled from the profile, and an item's defaults follow the profile entry of the same
 * name (until an integration supplies them instead).
 */
export function profileListChanges(profile: Profile, state: State, now: Ms): ListItem[] {
  const out: ListItem[] = [];
  const items = Object.values(state.lists);
  for (const [list, entries] of Object.entries(profile.lists ?? {})) {
    const existing = items.filter((x) => x.list === list);
    entries.map(listEntry).forEach(({ name, defaults }, position) => {
      if (existing.length === 0) {
        out.push({ id: slugId(name), list, name, position, archived: false, defaults: defaults ?? null, createdAt: now, updatedAt: now, rev: 0 });
        return;
      }
      const item = existing.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (item && defaults && JSON.stringify(item.defaults ?? null) !== JSON.stringify(defaults)) {
        out.push({ ...item, defaults, updatedAt: now });
      }
    });
  }
  return out;
}

/**
 * Tasks and sessions that use one of `items` but lack a field its defaults give (sessions
 * from before work types had a billing default), with the defaults filled in. Values already
 * there are never changed.
 */
export function defaultsBackfill(state: State, items: ListItem[], now: Ms): { tasks: Task[]; sessions: Session[] } {
  const withDefaults = new Map(items.filter((x) => x.defaults).map((x) => [x.id, x.defaults!]));
  const fill = <T extends { fields: Fields; updatedAt: Ms }>(rec: T): T | null => {
    const add: Fields = {};
    for (const v of Object.values(rec.fields)) {
      for (const [k, d] of Object.entries(withDefaults.get(String(v)) ?? {})) if (!(k in rec.fields) && !(k in add)) add[k] = d;
    }
    return Object.keys(add).length ? { ...rec, fields: { ...rec.fields, ...add }, updatedAt: now } : null;
  };
  return {
    tasks: Object.values(state.tasks).map(fill).filter((x): x is Task => !!x),
    sessions: Object.values(state.sessions)
      .filter((s) => !s.deleted)
      .map(fill)
      .filter((x): x is Session => !!x),
  };
}
