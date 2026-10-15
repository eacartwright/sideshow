import { useState } from "react";
import { plural } from "../format";
import { useA, useM } from "../model";
import { Dialog } from "./Dialog";

// The profile's groupBy list (clients) without ConnectWise: remove the ones you don't use, and
// restore them. With CW the field picks CW companies, so there's nothing to tend (DESIGN.md §10).

export function ClientsDialog({ onClose }: { onClose: () => void }) {
  const m = useM();
  const a = useA();
  const def = m.groupBy;
  const [filter, setFilter] = useState("");
  if (!def?.list) return null;
  const list = def.list;
  const label = def.label.toLowerCase();

  const all = Object.values(m.view.lists)
    .filter((x) => x.list === list)
    .sort((x, y) => x.name.localeCompare(y.name));
  const active = all.filter((x) => !x.archived);
  const removed = all.filter((x) => x.archived);
  const shown = active.filter((x) => x.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Dialog title={plural(def.label)} onClose={onClose} className="clients">
      <div className="row-actions clients-filter">
        <input
          className="search"
          value={filter}
          placeholder={`Find a ${label}…`}
          aria-label={`Find a ${label}`}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <ul className="clients-list">
        {shown.map((x) => (
          <li key={x.id} className="client-row">
            <span className="client-name">{x.name}</span>
            <span className="row-actions">
              <button className="btn subtle danger" onClick={() => a.removeListItem(x.id)}>
                Remove
              </button>
            </span>
          </li>
        ))}
        {shown.length === 0 && <li className="muted pad">No {plural(label)}{filter ? " match" : " yet"}.</li>}
      </ul>

      {removed.length > 0 && (
        <details className="archived">
          <summary>Removed · {removed.length}</summary>
          <ul className="clients-list">
            {removed.map((x) => (
              <li key={x.id} className="client-row">
                <span className="client-name">{x.name}</span>
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
