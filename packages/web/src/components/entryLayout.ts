import { DEFAULT_ENTRY_FORMAT, type EntryFormat, type FieldDef, type FieldValue } from "@sideshow/shared";
import { useEffect, useState } from "react";
import { bareText, fieldText, type Model } from "../model";

// What the Day page's two forms share: the table (DayPage.tsx) and the list (EntryList.tsx).

export const CONTINUATION = "Continuation of previous work";

/** The entry format, with the profile's fields split into task-level and per-entry. */
export function layout(m: Model) {
  const fmt: EntryFormat = m.profile.entryFormat ?? {
    ...DEFAULT_ENTRY_FORMAT,
    // Without an entryFormat, every field the profile has.
    fields: [...DEFAULT_ENTRY_FORMAT.fields, ...m.profile.fields.map((d) => d.key)],
  };
  const def = (k: string) => m.profile.fields.find((d) => d.key === k);
  // The task's fields, the ticket first: they lead the table, filled in on each group's header row.
  const taskFields = fmt.fields.map(def).filter((d): d is FieldDef => d?.on === "task");
  const ticket = taskFields.filter((d) => d.key === m.profile.connectwise?.ticketField);
  const taskDefs = [...ticket, ...taskFields.filter((d) => !ticket.includes(d))];
  // Notes don't fit a table row in any useful way: they show on ✎ (hover) and in the push preview.
  const columns = fmt.fields.filter((k) => k !== "notes" && (!def(k) || def(k)!.on === "session"));
  // With an integration (CW) entries go there by push: the table is edited in place. Without one
  // they're typed into the other system by hand, so its values copy with a click.
  const editable = !!m.config.cw;
  return { fmt, def, taskDefs, columns, target: fmt.target ?? "the other system", editable };
}

/** What a field copies as: a list item's name, a ticket # without its "#". An unset field with a default copies that. */
export function copyValue(m: Model, d: FieldDef, v: FieldValue | undefined): string {
  v ??= d.default;
  if (d.type === "text") return bareText(d, v);
  if (d.type === "bool") return v ? "Yes" : "";
  return fieldText(d, v, m.view);
}

/** Whether a media query holds now, following it as the window changes. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const change = () => setOn(mq.matches);
    change();
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, [query]);
  return on;
}
