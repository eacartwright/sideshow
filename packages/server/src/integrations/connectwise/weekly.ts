import type { DB } from "../../db";
import type { ConnectWiseClient } from "./client";

// The weekly recurring internal ticket ("WRIT", DESIGN.md §10): a CW template makes a new one
// for each tech every Monday around 06:15 UTC, always summarized "Weekly Recurring Internal
// Ticket - <name>" and owned by them. Earlier weeks' tickets often stay open, so the current one
// is the newest with that summary and owner, not "the open one". The server keeps it (meta
// `cw.weekly`) and looks again only once it's due: at startup, and after the known one is
// about a week old.

export interface WeeklyTicket {
  ticket: number;
  summary: string;
  /** When CW made it (ms). */
  enteredAt: number;
}

const KEY = "cw.weekly";
const DUE_AFTER = 6.5 * 24 * 3_600_000;
const RECHECK = 3_600_000;

export class WeeklyTickets {
  private lastCheck = 0;
  private running: Promise<WeeklyTicket | null> | null = null;

  constructor(
    private db: DB,
    private cw: ConnectWiseClient,
    /** CW_MEMBER, e.g. ecartwright. */
    private member: string,
    /** The summary to look for; by default "Weekly Recurring Internal Ticket - <member's name>". */
    private summary: () => Promise<string | null>,
    private log: (msg: string) => void = console.log,
  ) {}

  current(): WeeklyTicket | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(KEY) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as WeeklyTicket) : null;
  }

  /** Look again if this week's should exist by now (and it's been an hour since the last try). */
  checkIfDue(now = Date.now()) {
    const known = this.current();
    const due = !known || now - known.enteredAt > DUE_AFTER;
    if (due && now - this.lastCheck > RECHECK) void this.check(now);
  }

  /** Ask CW for the newest one now. Joins a check already running. */
  check(now = Date.now()): Promise<WeeklyTicket | null> {
    this.lastCheck = now;
    this.running ??= this.find()
      .catch((err) => {
        this.log(`ConnectWise weekly ticket: check failed: ${(err as Error).message}`);
        return this.current();
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async find(): Promise<WeeklyTicket | null> {
    const summary = await this.summary();
    if (!summary) return this.current();
    const quote = (s: string) => s.replaceAll('"', '\\"');
    const t = await this.cw.newestTicket(`summary="${quote(summary)}" and owner/identifier="${quote(this.member)}"`);
    if (!t) return this.current();
    const found: WeeklyTicket = { ticket: t.id, summary: t.summary, enteredAt: Date.parse(t._info?.dateEntered ?? "") || Date.now() };
    const known = this.current();
    if (known?.ticket !== found.ticket) {
      this.db
        .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(KEY, JSON.stringify(found));
      this.log(`ConnectWise weekly ticket: #${found.ticket} (${found.summary})`);
    }
    return found;
  }
}
