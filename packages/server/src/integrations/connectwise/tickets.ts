import { newId, ticketNumber, type Id, type Profile } from "@sideshow/shared";
import type { Store } from "../../store";
import type { ConnectWiseClient } from "./client";
import { pushSessions, type PushResult } from "./push";

// Creating a CW ticket from a task (DESIGN.md §10, "Creating a ticket from a task"). The company
// is the one the task's client is linked to; the owner is CW_MEMBER unless left off, which puts
// the ticket in its board's queue. CW's automatic emails stay off. The new number goes onto the
// task with an op, so every device sees it, along with what a lookup would have found. Time the
// task already has can then be pushed to the new ticket in the same request.

export interface BoardChoice {
  id: number;
  name: string;
  types: { id: number; name: string; default: boolean }[];
  /** Open statuses only, in the board's order. */
  statuses: { id: number; name: string; default: boolean }[];
}

export interface NewTicket {
  taskId: Id;
  summary: string;
  boardId: number;
  typeId?: number;
  statusId?: number;
  /** Owner: CW_MEMBER. Off leaves the ticket unassigned. */
  assign: boolean;
  description?: string;
  /** The task's sessions to push to the new ticket once it's made (needs CW_MEMBER). */
  pushSessionIds?: Id[];
}

/** CW's limit on a ticket summary. */
export const SUMMARY_MAX = 100;

const HOUR = 3_600_000;

export class TicketMaker {
  private boards: { at: number; value: Promise<BoardChoice[]> } | null = null;
  private owner: Promise<{ id: number; name: string } | null> | null = null;
  /** Tasks with a ticket being made right now, so a second click can't make two. */
  private busy = new Set<Id>();

  constructor(
    private cw: ConnectWiseClient,
    private store: Store,
    private profile: Profile,
    private member: string | null,
  ) {}

  /** Service boards (not project boards) with their types and open statuses. Cached for an hour. */
  getBoards(): Promise<BoardChoice[]> {
    if (!this.boards || Date.now() - this.boards.at > HOUR) {
      const value = this.loadBoards();
      this.boards = { at: Date.now(), value };
      value.catch(() => (this.boards = null));
    }
    return this.boards.value;
  }

  /** One board at a time (two requests each), so opening the dialog isn't a burst CW turns away. */
  private async loadBoards(): Promise<BoardChoice[]> {
    const boards = (await this.cw.getBoards()).filter((b) => !b.projectFlag);
    const out: BoardChoice[] = [];
    for (const b of boards) {
      const [types, statuses] = await Promise.all([this.cw.getBoardTypes(b.id), this.cw.getBoardStatuses(b.id)]);
      out.push({
        id: b.id,
        name: b.name ?? `Board ${b.id}`,
        types: types.filter((t) => !t.inactiveFlag).map((t) => ({ id: t.id, name: t.name ?? "", default: !!t.defaultFlag })),
        statuses: statuses
          .filter((s) => !s.inactive && !s.closedStatus)
          .map((s) => ({ id: s.id, name: s.name ?? "", default: !!s.defaultFlag })),
      });
    }
    return out;
  }

  /** The CW member new tickets are assigned to (CW_MEMBER), with their name. */
  getOwner(): Promise<{ id: number; name: string } | null> {
    if (!this.member) return Promise.resolve(null);
    this.owner ??= this.cw.findMembers(`identifier="${this.member}"`).then(([m]) =>
      m ? { id: m.id, name: [m.firstName, m.lastName].filter(Boolean).join(" ") || m.identifier } : null,
    );
    this.owner.catch(() => (this.owner = null));
    return this.owner;
  }

  /** Why this task can't have a ticket made, or the company it would go to. */
  companyFor(taskId: Id): { companyId: number; company: string } | { error: string } {
    const cw = this.profile.connectwise!;
    const task = this.store.state.tasks[taskId];
    if (!task) return { error: "No such task" };
    if (ticketNumber(String(task.fields[cw.ticketField] ?? ""))) return { error: "This task already has a ticket" };
    if (!cw.clientField) return { error: "The profile has no client field" };
    const client = this.store.state.lists[String(task.fields[cw.clientField] ?? "")];
    if (!client) return { error: "Pick the client first" };
    const companyId = Number(client.ext?.cw?.companyId) || 0;
    if (!companyId) return { error: `${client.name} isn't linked to a ConnectWise company` };
    return { companyId, company: client.name };
  }

  /**
   * Make the ticket and put its number on the task, then push the sessions asked for. Resolves
   * to the ticket number and each push result, or why no ticket was made.
   */
  async create(t: NewTicket): Promise<{ ticketId: number; pushed?: PushResult[]; pushError?: string } | { error: string }> {
    const summary = t.summary.trim();
    if (!summary) return { error: "The ticket needs a summary" };
    if (summary.length > SUMMARY_MAX) return { error: `ConnectWise allows ${SUMMARY_MAX} characters in a summary` };
    if (this.busy.has(t.taskId)) return { error: "A ticket is already being made for this task" };
    const target = this.companyFor(t.taskId);
    if ("error" in target) return target;
    this.busy.add(t.taskId);
    try {
      const owner = t.assign ? await this.getOwner() : null;
      if (t.assign && !owner) return { error: `ConnectWise has no member "${this.member ?? ""}" (CW_MEMBER)` };
      const ticket = await this.cw.createTicket({
        summary,
        companyId: target.companyId,
        boardId: t.boardId,
        typeId: t.typeId,
        statusId: t.statusId,
        ownerId: owner?.id,
        initialDescription: t.description?.trim() || undefined,
      });
      const cw = this.profile.connectwise!;
      const at = Date.now();
      const ref = String(ticket.id);
      this.store.apply([
        { id: newId(), at, op: { type: "task.update", taskId: t.taskId, patch: { fields: { [cw.ticketField]: ref } } } },
        {
          id: newId(),
          at,
          op: {
            type: "task.refInfo",
            taskId: t.taskId,
            field: cw.ticketField,
            ref,
            info: {
              summary: ticket.summary ?? summary,
              company: ticket.company?.name ?? target.company,
              companyId: ticket.company?.id ?? target.companyId,
              closed: false,
              fetchedAt: at,
            },
          },
        },
      ]);
      // Only this task's sessions: the request can't push anything else through here.
      const ids = (t.pushSessionIds ?? []).filter((id) => this.store.state.sessions[id]?.taskId === t.taskId);
      if (!ids.length) return { ticketId: ticket.id };
      if (!this.member) return { ticketId: ticket.id, pushError: "Pushing isn't set up on the server (CW_MEMBER in .env)" };
      try {
        return { ticketId: ticket.id, pushed: await pushSessions(this.cw, this.store, this.profile, this.member, ids) };
      } catch (err) {
        console.error(err);
        return { ticketId: ticket.id, pushError: "The ticket was made, but its entries couldn't be pushed. Push them from the Day page." };
      }
    } finally {
      this.busy.delete(t.taskId);
    }
  }
}
