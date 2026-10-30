import { AI_MODELS, modelLabel, PROVIDER_NAMES, type AiProvider, type AiSettings as Settings, type AiUsage, type CleanupResult } from "@sideshow/shared";
import { useEffect, useState } from "react";
import { aiAlert, compareModels, loadAi, money, saveAiSettings, tokensK, type AiState } from "../ai";
import { showToast } from "../toast";
import { Spinner } from "./Spinner";

// Settings › AI (DESIGN.md §11): which model cleans up notes (Claude or GPT, whichever have a key
// on the server), this month's spend against the cap, the alerts, the templates, and Compare
// (the same notes through every model). One set for the whole server, not per workspace.

const ALERT_CHOICES = [50, 75, 90];
const PROVIDERS: AiProvider[] = ["anthropic", "openai"];
const KEY_NAME: Record<AiProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

export function AiSettings() {
  const [st, setSt] = useState<AiState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const take = (r: AiState | { error: string }) => {
    if ("error" in r) setError(r.error);
    else {
      setSt(r);
      setError(null);
    }
  };
  useEffect(() => void loadAi().then(take), []);
  const save = async (patch: Partial<Settings>) => {
    if (!st) return;
    const r = await saveAiSettings({ ...st.settings, ...patch });
    if ("error" in r) showToast(`Not saved: ${r.error}`);
    else take(r);
  };

  if (!st) return error ? <p className="warn small setting-help">{error}</p> : <p className="muted small busy-line"><Spinner /> Loading…</p>;
  const s = st.settings;
  return (
    <>
      <p className="muted small setting-help">
        Cleans up a session's notes (✨ in the session editor and on the Day page) before they're pushed. For the whole server, not per
        workspace. The keys stay in the server's <code>.env</code>.
      </p>
      {error && <p className="warn small setting-help">{error}</p>}
      <p className="small ai-keys">
        {PROVIDERS.map((p) => (
          <span key={p} className={st.providers.includes(p) ? "conn-ok" : "muted"}>
            {st.providers.includes(p) ? "●" : "○"} {PROVIDER_NAMES[p]}
            {st.providers.includes(p) ? "" : ` (no ${KEY_NAME[p]})`}
          </span>
        ))}
      </p>

      <section className="setting">
        <label htmlFor="ai-model" className="setting-label">
          Model
        </label>
        <select id="ai-model" className="select setting-select" value={s.model} onChange={(e) => void save({ model: e.target.value })}>
          <option value="off">Off</option>
          {PROVIDERS.map((p) => (
            <optgroup key={p} label={`${PROVIDER_NAMES[p]}${st.providers.includes(p) ? "" : " (no key)"}`}>
              {AI_MODELS.filter((m) => m.provider === p).map((m) => (
                <option key={m.id} value={m.id} disabled={!st.models.includes(m.id)}>
                  {m.label} · ${m.input} in / ${m.output} out per M tokens
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="muted small setting-help">The cleanup dialog can try another model each time; this is the one it starts with.</p>
      </section>

      <section className="setting">
        <span className="setting-label">This month</span>
        <Spend use={st.usage} ai={s} />
      </section>

      <section className="setting">
        <label htmlFor="ai-cap" className="setting-label">
          Monthly cap
        </label>
        <span className="row-actions">
          $
          <CapInput value={s.monthlyLimitUsd} onCommit={(monthlyLimitUsd) => void save({ monthlyLimitUsd })} />
        </span>
        <p className="muted small setting-help">At the cap no more calls are made until the month turns (the call that crosses it still finishes). Empty: no cap.</p>
      </section>

      <section className="setting">
        <span className="setting-label" id="ai-alerts">
          Alerts at
        </span>
        <span className="segmented" role="group" aria-labelledby="ai-alerts">
          {ALERT_CHOICES.map((p) => {
            const on = s.alertsAt.includes(p);
            return (
              <button key={p} type="button" className={`seg ${on ? "seg-on" : ""}`} aria-pressed={on} onClick={() => void save({ alertsAt: on ? s.alertsAt.filter((x) => x !== p) : [...s.alertsAt, p] })}>
                {p}%
              </button>
            );
          })}
        </span>
        <p className="muted small setting-help">A call that crosses one of these (or the cap) says so.</p>
      </section>

      <Templates st={st} />

      <h3 className="settings-group">Compare</h3>
      <Compare st={st} onDone={() => void loadAi().then(take)} />
    </>
  );
}

/** Dollars, saved on leaving the box; empty = no cap. */
function CapInput({ value, onCommit }: { value: number | null; onCommit: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => setDraft(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const v = draft.trim() === "" ? null : Number(draft);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return setDraft(value === null ? "" : String(value));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      id="ai-cap"
      className="editor-input ai-cap"
      inputMode="decimal"
      value={draft}
      placeholder="none"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

function Spend({ use, ai }: { use: AiUsage; ai: Settings }) {
  const cap = ai.monthlyLimitUsd;
  const pct = cap ? use.costUsd / cap : 0;
  const level = !cap ? "" : pct >= 1 ? "over" : ai.alertsAt.some((a) => pct * 100 >= a) ? "warn" : "";
  const [y, mo] = use.month.split("-").map(Number) as [number, number];
  const days = new Date(y, mo, 0).getDate();
  const byDay = new Map(use.byDay.map((d) => [d.day, d.costUsd]));
  const most = Math.max(...use.byDay.map((d) => d.costUsd), 0);
  const monthName = new Date(y, mo - 1, 1).toLocaleString([], { month: "short" });
  return (
    <div className="stack ai-spend">
      <div>
        <strong className="ai-total">{money(use.costUsd)}</strong> <span className="muted small">estimated</span>
        <span className="muted">
          {cap ? ` of $${cap.toFixed(2)} · ${Math.round(pct * 100)}%` : " (no cap)"}
          {level === "over" && " · cap reached, AI paused"}
          {level === "warn" && " · past an alert"}
        </span>
      </div>
      {!!cap && (
        <div className={`ai-meter ${level}`} role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={use.costUsd} aria-label="Spent this month">
          <div className="ai-meter-fill" style={{ width: `${Math.min(pct, 1) * 100}%` }} />
          {ai.alertsAt.map((a) => (
            <span key={a} className="ai-meter-tick" style={{ left: `${a}%` }} />
          ))}
        </div>
      )}
      <p className="small muted">
        {use.calls} call{use.calls === 1 ? "" : "s"} · {tokensK(use.tokens.input + use.tokens.cacheRead)} tokens in · {tokensK(use.tokens.output)} out
      </p>
      {use.calls > 0 && (
        <>
          <div className="ai-days" aria-label="Cost by day">
            {Array.from({ length: days }, (_, i) => {
              const c = byDay.get(i + 1) ?? 0;
              return (
                <span key={i} className="ai-day" title={`${monthName} ${i + 1}: ${money(c)}`}>
                  {c > 0 && <span style={{ height: `${Math.max((c / most) * 100, 6)}%` }} />}
                </span>
              );
            })}
          </div>
          <table className="ai-table small">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Calls</th>
                <th className="num">In / out</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {use.byModel.map((b) => (
                <tr key={b.model}>
                  <td>{modelLabel(b.model)}</td>
                  <td className="num">{b.calls}</td>
                  <td className="num">
                    {tokensK(b.tokens.input + b.tokens.cacheRead)} / {tokensK(b.tokens.output)}
                  </td>
                  <td className="num">{money(b.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary className="small">Recent calls</summary>
            <ul className="ai-recent small">
              {use.recent.map((r, i) => (
                <li key={`${r.at}-${i}`}>
                  <span className="muted">{new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>{" "}
                  {modelLabel(r.model)} · {r.purpose} · {money(r.costUsd)}
                  {!r.ok && <span className="warn"> · {r.note || "failed"}</span>}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

/** The templates, as the server's ai-templates/ files say: read here, edited there. */
function Templates({ st }: { st: AiState }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <h3 className="settings-group">Templates</h3>
      <p className="muted small setting-help">
        What shape the cleaned-up notes take. They're Markdown files in <code>packages/server/ai-templates/</code> (its README says how), read on
        every cleanup, so an edit shows on the next ✨ or Compare. The first one is the default; the cleanup dialog lets you pick another.
      </p>
      {st.templatesError && <p className="warn small">{st.templatesError}</p>}
      <ul className="ai-templates">
        {st.templates.map((t, i) => (
          <li key={t.id} className="ai-template">
            <button type="button" className="btn subtle ai-template-name" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
              <span aria-hidden>{open === t.id ? "▾" : "▸"}</span> {t.name}
              {i === 0 && <span className="muted small"> (default)</span>}
            </button>
            {open === t.id && <pre className="ai-instructions">{t.instructions}</pre>}
          </li>
        ))}
      </ul>
    </>
  );
}

type CompareRow = CleanupResult | { model: string; error: string };

/** The same notes through every model with a key, side by side, to choose between them. */
function Compare({ st, onDone }: { st: AiState; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  const [templateId, setTemplateId] = useState(st.templates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    const r = await compareModels({ notes, templateId });
    setBusy(false);
    if ("error" in r) setError(r.error);
    else {
      setRows(r.results);
      r.results.forEach((x) => "alerts" in x && aiAlert(x));
    }
    onDone();
  };
  return (
    <div className="stack">
      <p className="muted small setting-help">
        Paste some raw notes: each of the {st.models.length} models with a key cleans them up, with its time and cost. Counts toward this month.
      </p>
      <textarea className="dev-text" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Raw notes to try" aria-label="Notes to compare" />
      <div className="row-actions">
        {st.templates.length > 1 && (
          <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Template">
            {st.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn busy-line" disabled={!notes.trim() || busy || !st.models.length} onClick={() => void run()}>
          {busy && <Spinner />}
          {busy ? "Asking each model…" : "Compare models"}
        </button>
        {error && <span className="warn small">{error}</span>}
      </div>
      {rows && (
        <div className="ai-compare">
          {rows.map((r) => (
            <div key={r.model} className="ai-compare-card">
              <strong>{modelLabel(r.model)}</strong>
              <span className="muted small">
                {"error" in r ? r.error : `${(r.ms / 1000).toFixed(1)} s · ${money(r.costUsd)} · ${tokensK(r.tokens.input + r.tokens.cacheRead)} in / ${tokensK(r.tokens.output)} out`}
              </span>
              {"text" in r && <pre className="ai-compare-text">{r.text}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
