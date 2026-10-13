import { newId, ticketNumber, type Id, type Profile, type Session, type State } from "@sideshow/shared";
import type { Store } from "../../store";
import { fileIdsIn } from "../../files";
import { CwError, type ConnectWiseClient, type CwTimeEntryInput } from "./client";
import type { Attachments } from "./documents";

// Pushing sessions to ConnectWise as time entries (DESIGN.md §10, M4). Each session becomes one
// entry on its task's ticket, as the member in CW_MEMBER. The result is recorded on the session
// (ext.cw.entryId, and marked entered) with an op, so every device sees it. A session pushed
// before and edited since updates its entry instead of adding a second one.

const CONTINUATION = "Continuation of previous work";
const BILLING: Record<string, CwTimeEntryInput["billableOption"]> = {
  Billable: "Billable",
  "Do Not Bill": "DoNotBill",
  "No Charge": "NoCharge",
};

export interface PushResult {
  sessionId: Id;
  ok: boolean;
  action?: "created" | "updated";
  entryId?: number;
  error?: string;
}

/**
 * A note's Markdown as CW's notes take it. Pictures and files pasted in sideshow link to
 * sideshow, which CW users can't open: they go to the ticket as documents, and the note names
 * them instead ("*Attachment: screenshot.png*"). Underline is ++text++ in sideshow and
 * __text__ in CW (its editor's own form, seen 2026-10-13; plain Markdown would read it as bold).
 */
export function cwNotes(markdown: string): string {
  const name = (label: string, src: string) => {
    if (label.trim()) return label.trim();
    try {
      return decodeURIComponent(src.split("/").pop() ?? "") || "file";
    } catch {
      return "file";
    }
  };
  return markdown
    .replace(/!?\[([^\]]*)\]\((\/api\/files\/[^)\s]*)[^)]*\)/g, (_m, label: string, src: string) => `*Attachment: ${name(label, src)}*`)
    .replace(/\+\+(.+?)\+\+/g, "__$1__")
    .trim();
}

/** UTC, to the minute, as CW wants it: 2026-10-09T14:26:00Z. */
const cwTime = (t: number) => new Date(Math.round(t / 60_000) * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * The CW entry for a session, or why it can't be pushed. Pure: the ticket's kind and the work
 * type's CW id are looked up first and passed in.
 */
export function timeEntryFor(
  s: Session,
  state: State,
  profile: Profile,
  ctx: { member: string; ticketKind: (n: number) => CwTimeEntryInput["chargeToType"]; workTypeId: (name: string) => number | undefined },
): { entry: CwTimeEntryInput } | { error: string } {
  const cw = profile.connectwise;
  if (!cw) return { error: "The profile has no ConnectWise settings" };
  const task = state.tasks[s.taskId];
  if (!task || s.deleted) return { error: "Deleted" };
  if (s.end === null) return { error: "Still running: stop it first" };
  const ticket = Number(ticketNumber(String(task.fields[cw.ticketField] ?? "")));
  if (!ticket) return { error: "No ticket #" };

  const def = (k?: string) => (k ? profile.fields.find((f) => f.key === k) : undefined);
  const value = (k?: string) => (k ? (s.fields[k] ?? def(k)?.default) : undefined);

  const workTypeItem = cw.workTypeField ? state.lists[String(value(cw.workTypeField) ?? "")] : undefined;
  if (cw.workTypeField && !workTypeItem) return { error: "No work type" };
  const workTypeId = workTypeItem ? ctx.workTypeId(workTypeItem.name) : undefined;
  if (workTypeId === undefined) return { error: `ConnectWise has no work type "${workTypeItem?.name ?? ""}"` };

  const billing = BILLING[String(value(cw.billingField) ?? "")];
  if (!billing) return { error: "No billing" };
  const discussion = value(cw.noteToField) === "Discussion";
  const email = s.ext?.cw?.email === true;

  const start = cwTime(s.start);
  const end = cwTime(s.end);
  if (end <= start) return { error: "Shorter than a minute" };
  return {
    entry: {
      chargeToId: ticket,
      chargeToType: ctx.ticketKind(ticket),
      member: { identifier: ctx.member },
      timeStart: start,
      timeEnd: end,
      hoursDeduct: Math.round((s.deductMin / 60) * 100) / 100,
      workType: { id: workTypeId },
      billableOption: billing,
      notes: cwNotes(s.notes) || CONTINUATION,
      addToDetailDescriptionFlag: discussion,
      addToInternalAnalysisFlag: !discussion,
      addToResolutionFlag: false,
      emailResourceFlag: email,
      emailContactFlag: email,
      emailCcFlag: email,
    },
  };
}

/** Push sessions one after another; each result says what happened. */
export async function pushSessions(
  client: ConnectWiseClient,
  store: Store,
  profile: Profile,
  member: string,
  sessionIds: Id[],
  attachments?: Attachments,
): Promise<PushResult[]> {
  const cw = profile.connectwise!;
  // Look up what the entries need once: work type ids, and each ticket's kind.
  const workTypes = new Map((await client.getWorkTypes()).map((w) => [w.name ?? "", w.id]));
  const kinds = new Map<number, CwTimeEntryInput["chargeToType"]>();
  const results: PushResult[] = [];

  for (const sessionId of sessionIds) {
    const s = store.state.sessions[sessionId];
    if (!s) {
      results.push({ sessionId, ok: false, error: "No such session" });
      continue;
    }
    try {
      const task = store.state.tasks[s.taskId];
      const ticket = Number(ticketNumber(String(task?.fields[cw.ticketField] ?? "")));
      if (ticket && !kinds.has(ticket)) kinds.set(ticket, await client.ticketKind(ticket));
      const built = timeEntryFor(s, store.state, profile, {
        member,
        ticketKind: (n) => kinds.get(n) ?? "ServiceTicket",
        workTypeId: (name) => workTypes.get(name),
      });
      if ("error" in built) {
        results.push({ sessionId, ok: false, error: built.error });
        continue;
      }
      const { entry } = built;
      // Its files go onto the ticket first: if one can't, nothing is half pushed.
      const fileIds = fileIdsIn(s.notes);
      if (fileIds.length && attachments) await attachments.ensureOnTicket(fileIds, entry.chargeToId, entry.addToInternalAnalysisFlag);
      const known = Number(s.ext?.cw?.entryId) || 0;
      let action: PushResult["action"] = "created";
      let entryId: number;
      if (known) {
        try {
          const { emailResourceFlag, emailContactFlag, emailCcFlag, member: _m, chargeToId, chargeToType, ...change } = entry;
          // Only move the entry to another ticket if the task's ticket changed since the push.
          const moved = Number(s.ext?.cw?.ticket) !== chargeToId;
          entryId = (await client.updateTimeEntry(known, moved ? { ...change, chargeToId, chargeToType } : change)).id;
          action = "updated";
        } catch (err) {
          // Deleted in CW since: make it again.
          if (!(err instanceof CwError) || err.status !== 404) throw err;
          entryId = (await client.createTimeEntry(entry)).id;
        }
      } else {
        entryId = (await client.createTimeEntry(entry)).id;
      }
      const at = Date.now();
      store.apply([
        {
          id: newId(),
          at,
          op: {
            type: "session.update",
            sessionId,
            patch: { ext: { cw: { entryId, ticket: entry.chargeToId, pushedAt: at, removedAt: null } }, enteredAt: at },
          },
        },
      ]);
      results.push({ sessionId, ok: true, action, entryId });
    } catch (err) {
      console.error(`push ${sessionId}:`, err);
      results.push({ sessionId, ok: false, error: cwMessage(err) });
    }
  }
  return results;
}

/**
 * Sessions whose CW entry has been deleted in CW since they were pushed: put back on To enter,
 * with ext.cw.removedAt so the row can say why. Returns their ids.
 */
export async function checkPushed(client: ConnectWiseClient, store: Store, sessionIds: Id[]): Promise<Id[]> {
  const pushed = sessionIds
    .map((id) => store.state.sessions[id])
    .filter((s): s is Session => !!s && !s.deleted && Number(s.ext?.cw?.entryId) > 0);
  if (!pushed.length) return [];
  const exists = await client.existingTimeEntryIds(pushed.map((s) => Number(s.ext!.cw!.entryId)));
  const gone = pushed.filter((s) => !exists.has(Number(s.ext!.cw!.entryId)));
  if (gone.length) {
    const at = Date.now();
    store.apply(
      gone.map((s) => ({
        id: newId(),
        at,
        op: {
          type: "session.update" as const,
          sessionId: s.id,
          patch: { ext: { cw: { entryId: null, ticket: null, pushedAt: null, removedAt: at } }, enteredAt: null },
        },
      })),
    );
  }
  return gone.map((s) => s.id);
}

/** CW's error bodies are JSON with a message (and sometimes per-field errors); keep them short. */
function cwMessage(err: unknown): string {
  if (!(err instanceof CwError)) return err instanceof Error && err.message.startsWith("Couldn't attach") ? err.message : "ConnectWise didn't answer";
  try {
    const body = JSON.parse(err.body) as { message?: string; errors?: { message?: string }[] };
    const detail = body.errors?.map((e) => e.message).filter(Boolean).join("; ");
    return `ConnectWise (${err.status}): ${detail || body.message || "error"}`;
  } catch {
    return `ConnectWise (${err.status})`;
  }
}
