import { companyKey, searchCompanies, type CompanyInfo, type ListItem } from "@sideshow/shared";
import { useState } from "react";
import { refreshCompanies, useCompanies } from "../companies";
import { useA, useM } from "../model";
import { Dialog } from "./Dialog";
import { ComboPicker, CompanyLabel, companyNote, ItemName, linkedCompanyId } from "./fields";

// Your clients (the profile's groupBy list): link each to its CW company, unlink, remove and
// restore. With CW, linking is what lets a ticket be created for the client (DESIGN.md §10).

const ago = (t: number) => {
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

export function ClientsDialog({ onClose }: { onClose: () => void }) {
  const m = useM();
  const a = useA();
  const def = m.groupBy;
  const cwOn = !!m.config.cw && def?.key === m.profile.connectwise?.clientField;
  const cw = useCompanies(cwOn);
  const [filter, setFilter] = useState("");
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  if (!def?.list) return null;
  const list = def.list;
  const label = def.label.toLowerCase();

  const all = Object.values(m.view.lists)
    .filter((x) => x.list === list)
    .sort((x, y) => x.name.localeCompare(y.name));
  const active = all.filter((x) => !x.archived);
  const removed = all.filter((x) => x.archived);
  const linkedBy = new Map(active.map((x) => [linkedCompanyId(x), x] as const).filter(([id]) => id !== undefined));
  const shown = active.filter(
    (x) => x.name.toLowerCase().includes(filter.trim().toLowerCase()) && (!unlinkedOnly || linkedCompanyId(x) === undefined),
  );

  // Unlinked clients whose name is a CW company's (not an older duplicate, not linked yet).
  const byKey = new Map<string, CompanyInfo>();
  for (const c of cw.companies) if (c.dupOf === undefined && !linkedBy.has(c.id)) byKey.set(companyKey(c.name), c);
  const matches = cwOn
    ? active.flatMap((x) => {
        const c = linkedCompanyId(x) === undefined ? byKey.get(companyKey(x.name)) : undefined;
        return c ? [{ item: x, company: c }] : [];
      })
    : [];

  return (
    <Dialog title={`${def.label}s`} onClose={onClose} className="clients">
      {cwOn && (
        <p className="muted small clients-sync">
          ConnectWise: {cw.companies.length} companies
          {cw.syncedAt ? `, updated ${ago(cw.syncedAt)}` : ""}
          {cw.error && <span className="warn"> · {cw.error}</span>}
          <button className="btn subtle" disabled={cw.busy} onClick={() => void refreshCompanies()}>
            {cw.busy ? "Updating…" : "Update now"}
          </button>
        </p>
      )}

      {matches.length > 0 && (
        <section className="clients-matches">
          <p>
            {matches.length === 1 ? `1 ${label} has` : `${matches.length} ${label}s have`} the name of a ConnectWise company.
          </p>
          <details>
            <summary className="muted small">Which</summary>
            <ul className="small">
              {matches.map(({ item, company }) => (
                <li key={item.id}>
                  {item.name} → {company.name} <span className="muted">({companyNote(company)})</span>
                </li>
              ))}
            </ul>
          </details>
          <button className="btn" onClick={() => matches.forEach(({ item, company }) => a.linkListItem(item.id, company.id))}>
            Link {matches.length === 1 ? "it" : `all ${matches.length}`}
          </button>
        </section>
      )}

      <div className="row-actions clients-filter">
        <input
          className="search"
          value={filter}
          placeholder={`Find a ${label}…`}
          aria-label={`Find a ${label}`}
          onChange={(e) => setFilter(e.target.value)}
        />
        {cwOn && (
          <label className="muted small nowrap">
            <input type="checkbox" checked={unlinkedOnly} onChange={(e) => setUnlinkedOnly(e.target.checked)} /> Not linked only
          </label>
        )}
      </div>

      <ul className="clients-list">
        {shown.map((x) => (
          <ClientRow key={x.id} item={x} cwOn={cwOn} companies={cw.companies} byId={cw.byId} linkedBy={linkedBy} />
        ))}
        {shown.length === 0 && <li className="muted pad">No {label}s{filter ? " match" : " yet"}.</li>}
      </ul>

      {removed.length > 0 && (
        <details className="archived">
          <summary>Removed · {removed.length}</summary>
          <ul className="clients-list">
            {removed.map((x) => (
              <li key={x.id} className="client-row">
                <span className="client-name">
                  <ItemName item={x} />
                </span>
                <span className="row-actions">
                  <button className="btn subtle" onClick={() => a.restoreListItem(x.id)}>
                    Restore
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Dialog>
  );
}

function ClientRow({
  item,
  cwOn,
  companies,
  byId,
  linkedBy,
}: {
  item: ListItem;
  cwOn: boolean;
  companies: CompanyInfo[];
  byId: Map<number, CompanyInfo>;
  linkedBy: Map<number | undefined, ListItem>;
}) {
  const a = useA();
  const [dups, setDups] = useState(false);
  const companyId = linkedCompanyId(item);
  const company = companyId !== undefined ? byId.get(companyId) : undefined;
  return (
    <li className="client-row">
      <span className="client-name">
        <ItemName item={item} />
        {cwOn && (
          <span className="muted small">
            {companyId === undefined
              ? "Not linked"
              : company
                ? `${company.name === item.name ? "" : `${company.name} · `}${companyNote(company)}`
                : `CW company #${companyId} (not found in ConnectWise)`}
          </span>
        )}
      </span>
      <span className="row-actions">
        {cwOn && (
          <ComboPicker
            chip={companyId === undefined ? "Link…" : "Change…"}
            chipTitle="Link to a ConnectWise company"
            set={false}
            placeholder="Find a ConnectWise company…"
            empty="No match"
            options={(_query, typed) =>
              searchCompanies(companies, typed || item.name, { withDuplicates: dups, limit: 10 }).map((c) => {
                const other = linkedBy.get(c.id);
                return {
                  key: String(c.id),
                  text: c.name,
                  label: <CompanyLabel c={c} linkedTo={other && other.id !== item.id ? other.name : undefined} />,
                  pick: () => a.linkListItem(item.id, c.id),
                };
              })
            }
            footer={
              <label className="picker-footer muted small">
                <input type="checkbox" checked={dups} onChange={(e) => setDups(e.target.checked)} />
                Show older duplicates
              </label>
            }
          />
        )}
        {cwOn && companyId !== undefined && (
          <button className="btn subtle" onClick={() => a.linkListItem(item.id, null)}>
            Unlink
          </button>
        )}
        <button className="btn subtle danger" onClick={() => a.removeListItem(item.id)}>
          Remove
        </button>
      </span>
    </li>
  );
}
