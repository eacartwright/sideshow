import type { ConnectWiseClient, CwSearchTicket } from "./client";
import { CwError } from "./client";

// Finding a ticket from the app (DESIGN.md §10). The app sends what's typed, maybe a company and
// "mine"; this searches CW's service and project tickets live and answers with one list. If one
// kind fails (the other's results are still useful) the answer says so instead of failing whole.

export interface TicketQuery {
  q?: string;
  companyId?: number;
  /** Only tickets owned by or assigned to this CW member (an identifier). */
  member?: string;
  closed?: boolean;
}

export interface TicketHit {
  id: number;
  summary: string;
  kind: "service" | "project";
  company: string;
  companyId: number | null;
  board: string;
  status: string;
  project?: string;
  phase?: string;
  closed: boolean;
  mine: boolean;
}

/** How many of each kind come back: enough to scroll, few enough to read. */
const PAGE = 40;

/** A value inside a CW conditions string: double-quoted, with \ and " escaped. */
const quoted = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** The CW conditions for a search. Every word has to match somewhere. */
export function ticketConditions(kind: "service" | "project", q: TicketQuery): string {
  const parts: string[] = [];
  if (!q.closed) parts.push("closedFlag=false");
  if (q.companyId) parts.push(`company/id=${q.companyId}`);
  if (q.member) parts.push(`(owner/identifier="${quoted(q.member)}" or resources like "%${quoted(q.member)}%")`);
  const searched = ["summary", "company/name", ...(kind === "project" ? ["project/name"] : [])];
  for (const word of (q.q ?? "").trim().split(/\s+/).filter(Boolean)) {
    parts.push(`(${searched.map((f) => `${f} like "%${quoted(word)}%"`).join(" or ")})`);
  }
  return parts.join(" and ");
}

function hit(t: CwSearchTicket, kind: "service" | "project", member: string | null): TicketHit {
  const mine = !!member && (t.owner?.identifier === member || (t.resources ?? "").split(/[,\s]+/).includes(member));
  return {
    id: t.id,
    summary: t.summary,
    kind,
    company: t.company?.name ?? "",
    companyId: t.company?.id ?? null,
    board: t.board?.name ?? "",
    status: t.status?.name ?? "",
    ...(t.project?.name ? { project: t.project.name } : {}),
    ...(t.phase?.name ? { phase: t.phase.name } : {}),
    closed: !!t.closedFlag,
    mine,
  };
}

/** Yours first, then newest; open before closed. */
function order(a: TicketHit, b: TicketHit) {
  return Number(a.closed) - Number(b.closed) || Number(b.mine) - Number(a.mine) || b.id - a.id;
}

export async function searchTickets(
  cw: ConnectWiseClient,
  query: TicketQuery,
  /** Who "mine" means, for marking results even when not filtering on it. */
  me: string | null,
): Promise<{ tickets: TicketHit[]; note?: string }> {
  const text = (query.q ?? "").trim().replace(/^#/, "");
  // A number is that ticket, service or project; a wrong number just finds nothing.
  if (/^\d+$/.test(text)) {
    try {
      const t = await cw.getTicket(Number(text));
      const kind = t.recordType === "ProjectTicket" || t.recordType === "ProjectIssue" ? "project" : "service";
      return { tickets: [hit(t, kind, me)] };
    } catch (err) {
      if (err instanceof CwError && err.status === 404) return { tickets: [] };
      throw err;
    }
  }
  const kinds = ["service", "project"] as const;
  const results = await Promise.allSettled(kinds.map((kind) => cw.searchTickets(kind, ticketConditions(kind, query), PAGE)));
  const tickets: TicketHit[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") tickets.push(...r.value.map((t) => hit(t, kinds[i]!, me)));
    else {
      failed.push(kinds[i]!);
      console.error(`CW ${kinds[i]} ticket search:`, r.reason);
    }
  });
  if (failed.length === kinds.length) throw (results[0] as PromiseRejectedResult).reason;
  return { tickets: tickets.sort(order), ...(failed.length ? { note: `Couldn't search ${failed[0]} tickets just now` } : {}) };
}
