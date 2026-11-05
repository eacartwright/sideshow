import { api } from "./sync";

// Finding a ConnectWise ticket from the app (DESIGN.md §10): searched live on the server, nothing
// kept here. A search that half worked (say project tickets failed) has both tickets and a note.

export interface TicketHit {
  id: number;
  summary: string;
  kind: "service" | "project";
  company: string;
  companyId: number | null;
  board: string;
  status: string;
  /** A project ticket's project and phase. */
  project?: string;
  phase?: string;
  closed: boolean;
  /** Owned by or assigned to you. */
  mine: boolean;
}
export interface TicketSearch {
  q?: string;
  companyId?: number | null;
  mine?: boolean;
  closed?: boolean;
}
export interface TicketResults {
  tickets: TicketHit[];
  note?: string;
}

/** One note or time entry on a ticket's page. */
export interface TicketActivity {
  id: string;
  kind: "note" | "time";
  who: string;
  at: string;
  end?: string;
  text: string;
  internal?: string;
  where: string[];
  hours?: number;
  workType?: string;
  billing?: string;
}
/** A ticket's page (server: ticketview.ts). */
export interface TicketPage {
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
  description?: string;
  activity: TicketActivity[];
  note?: string;
}

export async function fetchTicketView(id: number): Promise<TicketPage> {
  const res = await api(`/api/cw/tickets/${id}/view`);
  return (await res.json()) as TicketPage;
}

export async function searchTickets(s: TicketSearch): Promise<TicketResults> {
  const q = new URLSearchParams();
  if (s.q?.trim()) q.set("q", s.q.trim());
  if (s.companyId) q.set("companyId", String(s.companyId));
  if (s.mine) q.set("mine", "1");
  if (s.closed) q.set("closed", "1");
  const res = await api(`/api/cw/ticket-search?${q}`);
  return (await res.json()) as TicketResults;
}
