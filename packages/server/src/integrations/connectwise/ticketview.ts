import { CwError, type ConnectWiseClient, type CwTicketDetail, type CwTicketNoteDetail, type CwTimeEntryDetail } from "./client";

// A ticket as the app's read-only ticket page shows it (DESIGN.md §10): its details, and everyone's
// notes and time entries as one list, newest first. Read live each time, nothing kept. If the notes
// or the time entries can't be read the rest still shows, and the answer says what's missing.

export interface TicketActivity {
  id: string;
  kind: "note" | "time";
  who: string;
  /** ISO time: when a note was written, when a time entry started. */
  at: string;
  /** A time entry's end, ISO. */
  end?: string;
  text: string;
  /** A time entry's internal notes, kept apart from what the client can see. */
  internal?: string;
  /** Where it shows on the ticket. */
  where: ("Discussion" | "Internal" | "Resolution")[];
  hours?: number;
  workType?: string;
  billing?: string;
}

export interface TicketView {
  id: number;
  summary: string;
  kind: "service" | "project";
  closed: boolean;
  company: string;
  companyId: number | null;
  site?: string;
  contact?: { name: string; email?: string; phone?: string };
  board?: string;
  status?: string;
  priority?: string;
  /** Type, subtype and item, as far as it has them. */
  type?: string;
  owner?: string;
  resources: string[];
  project?: string;
  phase?: string;
  enteredAt?: string;
  enteredBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  hours?: number;
  /** The ticket's description: its oldest Discussion note. */
  description?: string;
  activity: TicketActivity[];
  /** What couldn't be read, or was cut off. */
  note?: string;
}

/** Enough for a long ticket; older than this, CW's page has it. */
const LIMIT = 200;

const clean = (v: string | undefined | null) => v?.trim() || undefined;

function whereOf(detail?: boolean, internal?: boolean, resolution?: boolean): TicketActivity["where"] {
  return [...(detail ? (["Discussion"] as const) : []), ...(internal ? (["Internal"] as const) : []), ...(resolution ? (["Resolution"] as const) : [])];
}

function noteItem(n: CwTicketNoteDetail): TicketActivity {
  return {
    id: `n${n.id}`,
    kind: "note",
    who: clean(n.member?.name) ?? clean(n.contact?.name) ?? clean(n.createdBy) ?? clean(n.member?.identifier) ?? "",
    at: n.dateCreated ?? n._info?.dateEntered ?? n._info?.lastUpdated ?? "",
    text: n.text ?? "",
    where: whereOf(n.detailDescriptionFlag, n.internalAnalysisFlag, n.resolutionFlag),
  };
}

function timeItem(t: CwTimeEntryDetail): TicketActivity {
  return {
    id: `t${t.id}`,
    kind: "time",
    who: clean(t.member?.name) ?? clean(t.member?.identifier) ?? "",
    at: t.timeStart,
    ...(t.timeEnd ? { end: t.timeEnd } : {}),
    text: t.notes ?? "",
    ...(clean(t.internalNotes) ? { internal: t.internalNotes!.trim() } : {}),
    where: whereOf(t.addToDetailDescriptionFlag, t.addToInternalAnalysisFlag, t.addToResolutionFlag),
    ...(typeof t.actualHours === "number" ? { hours: t.actualHours } : {}),
    ...(t.workType?.name ? { workType: t.workType.name } : {}),
    ...(t.billableOption ? { billing: t.billableOption } : {}),
  };
}

/** Details, from a ticket as CW sends it. */
function details(t: CwTicketDetail, kind: "service" | "project"): Omit<TicketView, "activity"> {
  const type = [t.type?.name, t.subType?.name, t.item?.name].filter(Boolean).join(" › ");
  const contactName = clean(t.contactName) ?? clean(t.contact?.name);
  return {
    id: t.id,
    summary: t.summary,
    kind,
    closed: !!t.closedFlag,
    company: t.company?.name ?? "",
    companyId: t.company?.id ?? null,
    ...(clean(t.site?.name) ? { site: t.site!.name } : {}),
    ...(contactName
      ? {
          contact: {
            name: contactName,
            ...(clean(t.contactEmailAddress) ? { email: t.contactEmailAddress } : {}),
            ...(clean(t.contactPhoneNumber) ? { phone: t.contactPhoneNumber } : {}),
          },
        }
      : {}),
    ...(t.board?.name ? { board: t.board.name } : {}),
    ...(t.status?.name ? { status: t.status.name } : {}),
    ...(t.priority?.name ? { priority: t.priority.name } : {}),
    ...(type ? { type } : {}),
    ...(clean(t.owner?.name) || clean(t.owner?.identifier) ? { owner: clean(t.owner?.name) ?? clean(t.owner?.identifier) } : {}),
    resources: (t.resources ?? "").split(",").map((r) => r.trim()).filter(Boolean),
    ...(t.project?.name ? { project: t.project.name } : {}),
    ...(t.phase?.name ? { phase: t.phase.name } : {}),
    ...(t._info?.dateEntered ? { enteredAt: t._info.dateEntered } : {}),
    ...(t._info?.enteredBy ? { enteredBy: t._info.enteredBy } : {}),
    ...(t._info?.lastUpdated ? { updatedAt: t._info.lastUpdated } : {}),
    ...(t._info?.updatedBy ? { updatedBy: t._info.updatedBy } : {}),
    ...(typeof t.actualHours === "number" ? { hours: t.actualHours } : {}),
  };
}

/** The ticket page's data, or null if there's no such ticket. */
export async function ticketView(cw: ConnectWiseClient, id: number): Promise<TicketView | null> {
  let ticket: CwTicketDetail;
  try {
    ticket = await cw.getTicket(id);
  } catch (err) {
    if (err instanceof CwError && err.status === 404) return null;
    throw err;
  }
  const kind = ticket.recordType === "ProjectTicket" || ticket.recordType === "ProjectIssue" ? "project" : "service";
  const [notes, time] = await Promise.allSettled([cw.ticketNoteList(kind, id, LIMIT), cw.ticketTimeEntries(kind, id, LIMIT)]);
  const missing: string[] = [];
  if (notes.status === "rejected") {
    missing.push("Couldn't read this ticket's notes.");
    console.error(`CW notes of #${id}:`, notes.reason);
  }
  if (time.status === "rejected") {
    missing.push("Couldn't read this ticket's time entries.");
    console.error(`CW time entries of #${id}:`, time.reason);
  }
  const noteRows = notes.status === "fulfilled" ? notes.value : [];
  const timeRows = time.status === "fulfilled" ? time.value : [];
  if (noteRows.length >= LIMIT || timeRows.length >= LIMIT) missing.push(`Showing the latest ${LIMIT}; ConnectWise has the rest.`);

  const items = noteRows.map(noteItem);
  // The oldest Discussion note is the ticket's description: shown as that, not again in the list.
  const first = items
    .filter((n) => n.where.includes("Discussion") && n.text.trim())
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  const activity = [...items.filter((n) => n !== first), ...timeRows.map(timeItem)].sort((a, b) => b.at.localeCompare(a.at));
  return {
    ...details(ticket, kind),
    ...(first ? { description: first.text } : {}),
    activity,
    ...(missing.length ? { note: missing.join(" ") } : {}),
  };
}
