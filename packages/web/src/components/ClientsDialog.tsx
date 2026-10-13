import { companyKey, searchCompanies, type CompanyInfo, type ListItem } from "@sideshow/shared";
import { useState } from "react";
import { refreshCompanies, syncText, useCompanies } from "../companies";
import { useA, useM } from "../model";
import { Dialog } from "./Dialog";
import { Spinner } from "./Spinner";
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

const tasksText = (n: number) => (n === 1 ? "1 task" : `${n} tasks`);

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

  // Several clients linked to one company: merged into the one with the company's name (else
  // the one most tasks use), so each company is one client.
  const byCompany = new Map<number, ListItem[]>();
  for (const x of active) {
    const id = linkedCompanyId(x);
    if (id !== undefined) byCompany.set(id, [...(byCompany.get(id) ?? []), x]);
  }
  const uses = (x: ListItem) => [...m.tasks.values()].filter((t) => t.groupItem?.id === x.id).length;
  const merges = cwOn
    ? [...byCompany]
        .filter(([, items]) => items.length > 1)
        .map(([id, items]) => {
          const company = cw.byId.get(id);
          const keep = [...items].sort((x, y) => Number(y.name === company?.name) - Number(x.name === company?.name) || uses(y) - uses(x))[0]!;
          return { company, keep, others: items.filter((x) => x !== keep) };
        })
    : [];
  const merging = new Set(merges.flatMap((g) => g.others.map((x) => x.id)));

  // Linked clients still under another name than their company's ("Veritaz" for "Veritaz IT Solutions").
  const renames = cwOn
    ? active.flatMap((x) => {
        const id = linkedCompanyId(x);
        const c = id !== undefined ? cw.byId.get(id) : undefined;
        return c && c.name.trim() !== x.name && !merging.has(x.id) ? [{ item: x, company: c }] : [];
      })
    : [];

  return (
    <Dialog title={`${def.label}s`} onClose={onClose} className="clients">
      {cwOn && (
        <p className="muted small clients-sync">
          {syncText(cw) ? (
            <span className="busy-line" role="status">
              <Spinner /> {syncText(cw)}
            </span>
          ) : (
            <span>
              ConnectWise: {cw.companies.length} companies
              {cw.syncedAt ? `, updated ${ago(cw.syncedAt)}` : ""}
            </span>
          )}
          {cw.error && <span className="warn">{cw.error}</span>}
          <button className="btn subtle" disabled={cw.syncing} onClick={() => void refreshCompanies()}>
            Update now
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
          <button className="btn" onClick={() => matches.forEach(({ item, company }) => a.linkListItem(item.id, company))}>
            Link {matches.length === 1 ? "it" : `all ${matches.length}`}
          </button>
        </section>
      )}

      {merges.length > 0 && (
        <section className="clients-matches">
          <p>
            {merges.length === 1 ? "Some clients are" : `${merges.length} companies have several clients`} linked to the same ConnectWise
            company. Merging keeps one and moves their tasks to it.
          </p>
          <ul className="small">
            {merges.map(({ company, keep, others }) => (
              <li key={keep.id}>
                {others.map((x) => `${x.name} (${tasksText(uses(x))})`).join(", ")} → {keep.name} ({tasksText(uses(keep))})
                {company && company.name !== keep.name ? ` (${company.name})` : ""}
              </li>
            ))}
          </ul>
          <button
            className="btn"
            onClick={() =>
              merges.forEach(({ keep, others, company }) => {
                a.mergeListItems(keep.id, others.map((x) => x.id));
                if (company && company.name !== keep.name) a.linkListItem(keep.id, company);
              })
            }
          >
            Merge
          </button>
        </section>
      )}

      {renames.length > 0 && (
        <section className="clients-matches">
          <p>
            {renames.length === 1 ? `1 linked ${label} has` : `${renames.length} linked ${label}s have`} a different name than in ConnectWise.
          </p>
          <ul className="small">
            {renames.map(({ item, company }) => (
              <li key={item.id}>
                {item.name} → {company.name}
              </li>
            ))}
          </ul>
          <button className="btn" onClick={() => renames.forEach(({ item, company }) => a.linkListItem(item.id, company))}>
            Use the ConnectWise name{renames.length === 1 ? "" : "s"}
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
                  pick: () => a.linkListItem(item.id, c),
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
