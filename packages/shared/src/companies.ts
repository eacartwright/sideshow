// Telling CW's duplicate company records apart (DESIGN.md §10, "Company picker"). CW has
// several records for many companies, mostly leftovers of type Customer from an old migration.
// Among records with the same name, the one with the most recent ticket is the company; the
// others are duplicates of it. Measured 2026-10-12: no two same-name records both have a
// ticket since 2025, so the rule never has to guess between two live ones.

/** A CW company as the server caches it. */
export interface CompanyInfo {
  id: number;
  name: string;
  identifier: string;
  /** "Active", "Special Info", "Former Client"… */
  status: string;
  /** "Client", "Customer", "Lead", "Former Client"… (a company can have several). */
  types: string[];
  /** Date (YYYY-MM-DD) of its newest service or project ticket; null if it has none. */
  lastTicket: string | null;
  /** The record this one duplicates, if it isn't the company itself. */
  dupOf?: number;
}

/** How a company shows in the picker: clients first, then leads, then former clients, then the rest. */
export type CompanyKind = "client" | "lead" | "former" | "other";

export function companyKind(c: Pick<CompanyInfo, "types">): CompanyKind {
  const has = (t: string) => c.types.includes(t);
  if (has("Client")) return "client";
  if (has("Lead") || has("Prospect")) return "lead";
  if (has("Former Client")) return "former";
  return "other";
}

const KIND_RANK: Record<CompanyKind, number> = { client: 0, lead: 1, former: 2, other: 3 };

/**
 * A company name reduced to what tells companies apart: lowercase, "&" as "and", punctuation
 * and brackets as spaces, and no Inc / LLC / PC… So "PDA Dental Group (Reading)" and
 * "PDA Dental Group - Reading" match, as do "Amerident Dental" and "Amerident Dental PC".
 */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|pc|pllc|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Which of two same-name records is more likely the company: newer ticket, then kind, then Customer last, then older id. */
function better(a: CompanyInfo, b: CompanyInfo): number {
  const t = (b.lastTicket ?? "").localeCompare(a.lastTicket ?? "");
  if (t) return t;
  const k = KIND_RANK[companyKind(a)] - KIND_RANK[companyKind(b)];
  if (k) return k;
  const leftover = (c: CompanyInfo) => (c.types.includes("Customer") ? 1 : 0);
  return leftover(a) - leftover(b) || a.id - b.id;
}

/** The same companies, each duplicate with `dupOf` set to the record it duplicates. */
export function markDuplicates(companies: CompanyInfo[]): CompanyInfo[] {
  const groups = new Map<string, CompanyInfo[]>();
  for (const c of companies) {
    const key = companyKey(c.name) || `#${c.id}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out: CompanyInfo[] = [];
  for (const group of groups.values()) {
    const [best, ...rest] = [...group].sort(better);
    out.push({ ...best!, dupOf: undefined });
    for (const c of rest) out.push({ ...c, dupOf: best!.id });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

/**
 * Companies matching what's typed, best first: names starting with it before names containing
 * it, then clients before leads before former clients. Duplicates only with `withDuplicates`.
 */
export function searchCompanies(companies: CompanyInfo[], query: string, opts: { withDuplicates?: boolean; limit?: number } = {}): CompanyInfo[] {
  const q = companyKey(query);
  const words = q.split(" ").filter(Boolean);
  const scored: { c: CompanyInfo; score: number }[] = [];
  for (const c of companies) {
    if (c.dupOf !== undefined && !opts.withDuplicates) continue;
    const key = companyKey(c.name);
    const id = c.identifier.toLowerCase();
    if (words.length && !words.every((w) => key.includes(w) || id.includes(w))) continue;
    const start = !q || key.startsWith(q) ? 0 : 1;
    scored.push({ c, score: start * 10 + KIND_RANK[companyKind(c)] + (c.dupOf !== undefined ? 5 : 0) });
  }
  scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, opts.limit ?? 20).map((x) => x.c);
}
