// Minimal ConnectWise Manage (PSA) REST client. See DESIGN.md §10.
//
// Auth: HTTP Basic where the username is "{companyId}+{publicKey}" and the password is the
// private key, plus a `clientId` header (a GUID registered at developer.connectwise.com).
// Docs: https://developer.connectwise.com/Products/Manage/REST

export interface CwConfig {
  site: string; // e.g. api-na.myconnectwise.net
  companyId: string;
  publicKey: string;
  privateKey: string;
  clientId: string;
  apiVersion?: string;
  /** Replaces https://{site}/v4_6_release/apis/3.0, e.g. to point tests at a fake CW. */
  baseUrl?: string;
}

export interface CwRef {
  id: number;
  name?: string;
  identifier?: string;
}

export interface CwCompany {
  id: number;
  identifier: string;
  name: string;
  status?: CwRef;
  types?: CwRef[];
  city?: string;
  state?: string;
  phoneNumber?: string;
}

export interface CwTicket {
  id: number;
  summary: string;
  /** ServiceTicket, ProjectTicket or ProjectIssue. */
  recordType?: string;
  company?: CwRef;
  board?: CwRef;
  status?: CwRef;
  owner?: CwRef;
  closedFlag?: boolean;
}

export interface CwMember {
  id: number;
  identifier: string;
  firstName?: string;
  lastName?: string;
  primaryEmail?: string;
  inactiveFlag?: boolean;
}

export interface CwTicketNote {
  id: number;
  ticketId: number;
  text: string;
  internalAnalysisFlag?: boolean;
  detailDescriptionFlag?: boolean;
  resolutionFlag?: boolean;
}

/** A time entry as sent to CW (POST /time/entries). Times are UTC ISO, to the minute. */
export interface CwTimeEntryInput {
  chargeToId: number;
  chargeToType: "ServiceTicket" | "ProjectTicket";
  member: { identifier: string };
  timeStart: string;
  timeEnd: string;
  hoursDeduct: number;
  workType: { id: number };
  billableOption: "Billable" | "DoNotBill" | "NoCharge";
  notes: string;
  addToDetailDescriptionFlag: boolean;
  addToInternalAnalysisFlag: boolean;
  addToResolutionFlag: boolean;
  emailResourceFlag: boolean;
  emailContactFlag: boolean;
  emailCcFlag: boolean;
}

export interface CwTimeEntry {
  id: number;
  chargeToId: number;
  chargeToType: string;
  timeStart: string;
  timeEnd: string;
  actualHours?: number;
}

/** Just enough of a ticket to tell when its company last had one. */
export interface CwTicketStamp {
  id: number;
  company?: { id: number };
  _info?: { dateEntered?: string };
}

type Params = Record<string, string | number | undefined>;

export class CwError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    method: string,
    path: string,
  ) {
    // CW puts the useful detail in the body, so keep it in the message.
    super(`ConnectWise ${method} ${path} → ${status}: ${body}`);
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): CwConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Missing ${k} (set it in .env at the repo root; see .env.example)`);
    return v;
  };
  return {
    site: need("CW_SITE"),
    companyId: need("CW_COMPANY_ID"),
    publicKey: need("CW_PUBLIC_KEY"),
    privateKey: need("CW_PRIVATE_KEY"),
    clientId: need("CW_CLIENT_ID"),
    baseUrl: env.CW_BASE_URL || undefined,
  };
}

export class ConnectWiseClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: CwConfig) {
    this.baseUrl = config.baseUrl ?? `https://${config.site}/v4_6_release/apis/3.0`;
    const auth = Buffer.from(
      `${config.companyId}+${config.publicKey}:${config.privateKey}`,
    ).toString("base64");
    this.headers = {
      Authorization: `Basic ${auth}`,
      clientId: config.clientId,
      Accept: `application/vnd.connectwise.com+json; version=${config.apiVersion ?? "2025.1"}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(method: string, path: string, params?: Params, body?: unknown): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new CwError(res.status, await res.text(), method, path);
    return (await res.json()) as T;
  }

  private get<T>(path: string, params?: Params) {
    return this.request<T>("GET", path, params);
  }

  private post<T>(path: string, body: unknown) {
    return this.request<T>("POST", path, undefined, body);
  }

  /** CW's PATCH takes a JSON Patch list: [{ op: "replace", path, value }]. */
  private patch<T>(path: string, values: Record<string, unknown>) {
    const ops = Object.entries(values).map(([k, value]) => ({ op: "replace", path: k, value }));
    return this.request<T>("PATCH", path, undefined, ops);
  }

  /**
   * Every page of a list endpoint. Orders by `id asc`: id is unique, so paging is stable.
   * Ordering by a non-unique field like name can return the same record on two pages.
   */
  private async getAll<T extends { id: number }>(path: string, conditions?: string, pageSize = 100, fields?: string) {
    const out: T[] = [];
    const seen = new Set<number>();
    for (let page = 1; ; page++) {
      const batch = await this.get<T[]>(path, { conditions, pageSize, page, orderBy: "id asc", fields });
      for (const item of batch) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
      if (batch.length < pageSize) return out;
    }
  }

  // ---- Companies ----

  /** Every company regardless of status, optionally narrowed by a CW conditions string. */
  getAllCompanies(conditions?: string) {
    return this.getAll<CwCompany>("/company/companies", conditions);
  }

  /** Status names are customizable per instance, so resolve the name rather than hardcoding an id. */
  async getCompanyStatusId(name = "Active"): Promise<number> {
    const [status] = await this.get<CwRef[]>("/company/companies/statuses", {
      conditions: `name="${name}"`,
    });
    if (!status) {
      throw new Error(
        `No company status named "${name}". Check System > Setup Tables > Company Status in CW.`,
      );
    }
    return status.id;
  }

  async getActiveCompanies(statusName = "Active") {
    const statusId = await this.getCompanyStatusId(statusName);
    return this.getAllCompanies(`status/id=${statusId}`);
  }

  /** Every company, with just what the company picker needs. */
  getCompanySummaries() {
    return this.getAll<Pick<CwCompany, "id" | "name" | "identifier" | "status" | "types">>(
      "/company/companies",
      undefined,
      1000,
      "id,name,identifier,status/name,types/name",
    );
  }

  /** Exact-name matches. CW has duplicate company records, so this returns all of them. */
  findCompaniesByName(name: string) {
    return this.get<CwCompany[]>("/company/companies", { conditions: `name="${name}"`, pageSize: 50 });
  }

  // ---- Tickets ----

  getTicket(id: number) {
    return this.get<CwTicket>(`/service/tickets/${id}`);
  }

  /** e.g. `summary like "%TEST%"` or `company/id=20021`. Newest first. */
  findTickets(conditions: string, pageSize = 25) {
    return this.get<CwTicket[]>("/service/tickets", { conditions, pageSize, orderBy: "id desc" });
  }

  getTicketNotes(ticketId: number) {
    return this.get<CwTicketNote[]>(`/service/tickets/${ticketId}/notes`, { pageSize: 100 });
  }

  /**
   * internal: Internal Analysis (not customer-visible); otherwise Discussion.
   * processNotifications stays off by default so CW doesn't email anyone off the note.
   */
  addTicketNote(ticketId: number, text: string, opts: { internal?: boolean; processNotifications?: boolean } = {}) {
    const internal = opts.internal ?? true;
    return this.post<CwTicketNote>(`/service/tickets/${ticketId}/notes`, {
      text,
      internalAnalysisFlag: internal,
      detailDescriptionFlag: !internal,
      resolutionFlag: false,
      processNotifications: opts.processNotifications ?? false,
    });
  }

  /**
   * board and status ids vary per instance; look them up first. ownerId is a member id; without
   * it the ticket is unassigned and waits on its board. CW's automatic emails to the contact,
   * CCs and resources stay off by default.
   */
  createTicket(t: {
    summary: string;
    companyId: number;
    boardId: number;
    statusId?: number;
    ownerId?: number;
    initialDescription?: string;
    emails?: boolean;
  }) {
    const emails = t.emails ?? false;
    return this.post<CwTicket>("/service/tickets", {
      summary: t.summary,
      company: { id: t.companyId },
      board: { id: t.boardId },
      ...(t.statusId ? { status: { id: t.statusId } } : {}),
      ...(t.ownerId ? { owner: { id: t.ownerId } } : {}),
      ...(t.initialDescription ? { initialDescription: t.initialDescription } : {}),
      automaticEmailContactFlag: emails,
      automaticEmailResourceFlag: emails,
      automaticEmailCcFlag: emails,
    });
  }

  /**
   * Whether a ticket number is a service or a project ticket (time entries need to know).
   * /service/tickets also returns project tickets, with recordType saying which; the project
   * endpoint is the fallback for instances where it doesn't.
   */
  async ticketKind(id: number): Promise<"ServiceTicket" | "ProjectTicket"> {
    try {
      const t = await this.getTicket(id);
      return t.recordType === "ProjectTicket" || t.recordType === "ProjectIssue" ? "ProjectTicket" : "ServiceTicket";
    } catch (err) {
      if (!(err instanceof CwError) || err.status !== 404) throw err;
      await this.get<CwTicket>(`/project/tickets/${id}`);
      return "ProjectTicket";
    }
  }

  /**
   * The newest service or project ticket (by id), optionally of one company: its id and when it
   * was entered. null if there are none.
   */
  async latestTicket(kind: "service" | "project", conditions?: string): Promise<CwTicketStamp | null> {
    const [t] = await this.get<CwTicketStamp[]>(`/${kind}/tickets`, {
      conditions,
      orderBy: "id desc",
      pageSize: 1,
      fields: "id,company/id,_info/dateEntered",
    });
    return t ?? null;
  }

  /** Every service or project ticket with an id above `afterId`: id, company and when entered. */
  ticketsAfter(kind: "service" | "project", afterId: number) {
    return this.getAll<CwTicketStamp>(`/${kind}/tickets`, `id>${afterId}`, 1000, "id,company/id,_info/dateEntered");
  }

  // ---- Time entries ----

  /** Adds the entry to the ticket (and the member's timesheet). Email flags decide who CW notifies. */
  createTimeEntry(entry: CwTimeEntryInput) {
    return this.post<CwTimeEntry>("/time/entries", entry);
  }

  /** Changes an entry made earlier. Leaves its email flags alone, so fixing an entry never re-sends mail. */
  updateTimeEntry(
    id: number,
    entry: Partial<Pick<CwTimeEntryInput, "chargeToId" | "chargeToType">> &
      Omit<CwTimeEntryInput, "emailResourceFlag" | "emailContactFlag" | "emailCcFlag" | "member" | "chargeToId" | "chargeToType">,
  ) {
    return this.patch<CwTimeEntry>(`/time/entries/${id}`, entry);
  }

  /** Which of these time entry ids still exist in CW. */
  async existingTimeEntryIds(ids: number[]): Promise<Set<number>> {
    const out = new Set<number>();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const found = await this.get<{ id: number }[]>("/time/entries", {
        conditions: `id in (${chunk.join(",")})`,
        fields: "id",
        pageSize: 1000,
      });
      for (const e of found) out.add(e.id);
    }
    return out;
  }

  /** Active work types, e.g. "Remote - Business Hours" → id 3. */
  getWorkTypes() {
    return this.getAll<CwRef & { inactiveFlag?: boolean }>("/time/workTypes", "inactiveFlag=false");
  }

  // ---- Lookups (ids vary per instance) ----

  /** Active service boards. */
  getBoards() {
    return this.getAll<CwRef & { inactiveFlag?: boolean }>("/service/boards", "inactiveFlag=false");
  }

  getBoardStatuses(boardId: number) {
    return this.getAll<CwRef & { defaultFlag?: boolean; closedStatus?: boolean; inactive?: boolean }>(
      `/service/boards/${boardId}/statuses`,
    );
  }

  /** e.g. `identifier="ecartwright"` or `firstName="Evan"`. */
  findMembers(conditions: string) {
    return this.get<CwMember[]>("/system/members", { conditions, pageSize: 25 });
  }
}
