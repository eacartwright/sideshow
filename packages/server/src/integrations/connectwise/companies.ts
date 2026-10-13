import { markDuplicates, type CompanyInfo } from "@sideshow/shared";
import { transaction, type DB } from "../../db";
import type { ConnectWiseClient, CwTicketStamp } from "./client";

// The server's copy of CW's companies, for the company picker (DESIGN.md §10). What tells the
// real record from its duplicates is when each last had a ticket, so the cache keeps that too.
// The first sync asks CW for each company's newest ticket (two requests per company, a minute
// or two); after that, a sync reads only the tickets made since the last one.

export interface CompanyCacheStatus {
  /** When the last sync finished; null if none has. */
  syncedAt: number | null;
  syncing: boolean;
  /** Why the last sync failed, if it did. */
  error: string | null;
}

const KINDS = ["service", "project"] as const;
const metaKey = (kind: string) => `cw.maxTicketId.${kind}`;
const day = (t: CwTicketStamp) => t._info?.dateEntered?.slice(0, 10) ?? null;

export class CompanyCache {
  private running: Promise<void> | null = null;
  private error: string | null = null;

  constructor(
    private db: DB,
    private cw: ConnectWiseClient,
    private log: (msg: string) => void = console.log,
  ) {}

  /** Every company still in CW, duplicates marked. */
  list(): CompanyInfo[] {
    const rows = this.db.prepare("SELECT * FROM cw_companies WHERE gone = 0").all() as any[];
    return markDuplicates(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        identifier: r.identifier,
        status: r.status,
        types: JSON.parse(r.types) as string[],
        lastTicket: r.last_ticket,
      })),
    );
  }

  status(): CompanyCacheStatus {
    const at = this.meta("cw.companiesSyncedAt");
    return { syncedAt: at ? Number(at) : null, syncing: this.running !== null, error: this.error };
  }

  /** Bring the cache up to date. `full` asks every company for its newest ticket again. Joins a sync already running. */
  sync(full = false): Promise<void> {
    this.running ??= this.run(full)
      .then(() => {
        this.error = null;
      })
      .catch((err) => {
        this.error = err instanceof Error ? err.message : String(err);
        this.log(`ConnectWise companies: sync failed: ${this.error}`);
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async run(full: boolean) {
    const started = Date.now();
    const companies = await this.cw.getCompanySummaries();
    const upsert = this.db.prepare(`INSERT INTO cw_companies (id, name, identifier, status, types, gone)
      VALUES (@id, @name, @identifier, @status, @types, 0)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, identifier = excluded.identifier,
        status = excluded.status, types = excluded.types, gone = 0`);
    transaction(this.db, () => {
      this.db.exec("UPDATE cw_companies SET gone = 1");
      for (const c of companies) {
        upsert.run({
          id: c.id,
          name: c.name,
          identifier: c.identifier ?? "",
          status: c.status?.name ?? "",
          types: JSON.stringify((c.types ?? []).map((t) => t.name ?? "").filter(Boolean)),
        });
      }
    });

    const fresh = full || KINDS.some((k) => this.meta(metaKey(k)) === null);
    if (fresh) await this.scanEveryCompany(companies.map((c) => c.id));
    else await this.readNewTickets();
    this.setMeta("cw.companiesSyncedAt", String(Date.now()));
    this.log(`ConnectWise companies: ${companies.length} synced${fresh ? " (every company's newest ticket)" : ""} in ${Math.round((Date.now() - started) / 1000)} s`);
  }

  /** Each company's newest ticket, asked one company at a time (8 at once). */
  private async scanEveryCompany(ids: number[]) {
    // The newest ticket ids now, so the next sync can read only what's newer.
    const top = await Promise.all(KINDS.map((k) => this.cw.latestTicket(k)));
    const set = this.db.prepare("UPDATE cw_companies SET last_ticket = ? WHERE id = ?");
    for (let i = 0; i < ids.length; i += 8) {
      await Promise.all(
        ids.slice(i, i + 8).map(async (id) => {
          const latest = await Promise.all(KINDS.map((k) => this.cw.latestTicket(k, `company/id=${id}`)));
          const days = latest.map((t) => (t ? day(t) : null)).filter((d): d is string => !!d);
          set.run(days.sort().at(-1) ?? null, id);
        }),
      );
    }
    KINDS.forEach((k, i) => this.setMeta(metaKey(k), String(top[i]?.id ?? 0)));
  }

  /** Tickets made since the last sync move their company's last ticket date forward. */
  private async readNewTickets() {
    const bump = this.db.prepare(
      "UPDATE cw_companies SET last_ticket = ? WHERE id = ? AND (last_ticket IS NULL OR last_ticket < ?)",
    );
    for (const kind of KINDS) {
      const after = Number(this.meta(metaKey(kind)));
      const tickets = await this.cw.ticketsAfter(kind, after);
      let max = after;
      for (const t of tickets) {
        max = Math.max(max, t.id);
        const d = day(t);
        if (t.company?.id && d) bump.run(d, t.company.id, d);
      }
      this.setMeta(metaKey(kind), String(max));
    }
  }

  private meta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
}
