import { modelLabel, plainNote, type CleanupResult, type Id, type Session } from "@sideshow/shared";
import { useEffect, useState } from "react";
import { aiAlert, cleanUpNotes, loadAi, money, tokensK, type AiState } from "../ai";
import { useA, useM } from "../model";
import { showToast } from "../toast";
import { Dialog } from "./Dialog";
import { Spinner } from "./Spinner";

// ✨ Clean up (DESIGN.md §11): a session's notes rewritten by the AI model from a template,
// reviewed (and editable) before they replace the notes. The raw notes are kept on the session
// (ext.ai.raw, the first ones if it's cleaned up twice), so they can always be put back.

// The template last used on this device: the dialog starts on it.
const LAST_TEMPLATE = "sideshow:aiTemplate";
const readLastTemplate = () => {
  try {
    return localStorage.getItem(LAST_TEMPLATE) ?? "";
  } catch {
    return "";
  }
};

/** ✨ beside a session's notes: shown when the server has an AI key and there are notes. */
export function CleanupButton({ session: s, className = "btn subtle", iconOnly = false }: { session: Session; className?: string; iconOnly?: boolean }) {
  const m = useM();
  const [open, setOpen] = useState(false);
  if (!m.config.ai || !plainNote(s.notes).trim()) return null;
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        title="Clean up these notes with AI, for review before they're used"
        aria-label={iconOnly ? "Clean up the notes with AI" : undefined}
      >
        ✨{iconOnly ? "" : " Clean up"}
      </button>
      {open && <CleanupDialog sessionId={s.id} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Under notes that were cleaned up: which model did it, and the way back. */
export function CleanedNote({ session: s }: { session: Session }) {
  const a = useA();
  const ai = s.ext?.ai;
  if (typeof ai?.raw !== "string") return null;
  return (
    <p className="muted small cleaned-note">
      ✨ Cleaned up{ai.model ? ` with ${modelLabel(String(ai.model))}` : ""}.{" "}
      <button
        type="button"
        className="link-btn"
        title={`Put back the notes as they were:\n\n${plainNote(ai.raw).slice(0, 500)}`}
        onClick={() => {
          a.updateSession(s.id, { notes: String(ai.raw), ext: { ai: { raw: null, model: null, template: null, at: null } } });
          showToast("Put the original notes back");
        }}
      >
        Restore the original
      </button>
    </p>
  );
}

export function CleanupDialog({ sessionId, onClose }: { sessionId: Id; onClose: () => void }) {
  const m = useM();
  const a = useA();
  const s = m.view.sessions[sessionId];
  const [ai, setAi] = useState<AiState | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [text, setText] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const context = s ? m.tasks.get(s.taskId)?.titleText : undefined;

  const run = async (opts: { templateId: string; model: string }) => {
    if (!s) return;
    try {
      localStorage.setItem(LAST_TEMPLATE, opts.templateId);
    } catch {
      // Not remembered.
    }
    setBusy(true);
    setError(null);
    const r = await cleanUpNotes({ notes: s.notes, templateId: opts.templateId, model: opts.model, context });
    setBusy(false);
    if ("error" in r) return setError(r.error);
    setResult(r);
    setText(r.text);
    aiAlert(r);
  };

  // With one template, opening it is asking for it: it runs straight away. With more, it waits
  // for the template (the last one used here to start with), so a call isn't spent on the wrong one.
  useEffect(() => {
    void loadAi().then((st) => {
      if ("error" in st) return setError(st.error);
      setAi(st);
      const last = readLastTemplate();
      const t = st.templates.some((x) => x.id === last) ? last : (st.templates[0]?.id ?? "");
      const md = st.models.includes(st.settings.model) ? st.settings.model : (st.models[0] ?? "");
      setTemplateId(t);
      setModel(md);
      if (st.templatesError) return setError(st.templatesError);
      if (st.settings.model === "off") return setError("AI is off (Settings › AI). Pick a model here to try one anyway.");
      if (md && st.templates.length === 1) void run({ templateId: t, model: md });
    });
  }, []);

  if (!s) return null;
  const accept = () => {
    const template = ai?.templates.find((t) => t.id === templateId)?.name ?? "";
    // The first raw notes stay, however many times it's cleaned up.
    const raw = typeof s.ext?.ai?.raw === "string" ? s.ext.ai.raw : s.notes;
    a.updateSession(s.id, { notes: text.trim(), ext: { ai: { raw, model: result?.model ?? model, template, at: Date.now() } } });
    showToast("Notes cleaned up (Restore the original is under them)");
    onClose();
  };

  return (
    <Dialog title="Clean up notes" onClose={onClose} className="cleanup">
      {ai && (
        <div className="cleanup-controls">
          {ai.templates.length > 1 && (
            <label className="field">
              <span className="field-label">Template</span>
              <select className="select" value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={busy}>
                {ai.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span className="field-label">Model</span>
            <select className="select" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
              {ai.models.map((id) => (
                <option key={id} value={id}>
                  {modelLabel(id)}
                  {id === ai.settings.model ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button className={result ? "btn busy-line" : "btn primary busy-line"} disabled={busy || !model} onClick={() => void run({ templateId, model })} autoFocus>
            {busy && <Spinner />}
            {result ? "Again" : "Clean up"}
          </button>
        </div>
      )}
      {ai?.templates.length === 1 && <p className="muted small cleanup-template">Template: {ai.templates[0]!.name}</p>}

      {busy && (
        <p className="muted small busy-line" role="status">
          <Spinner /> {modelLabel(model)} is tidying the notes…
        </p>
      )}
      {error && (
        <p className="warn small" role="alert">
          {error}
        </p>
      )}

      {result && !busy && (
        <>
          <label className="field">
            <span className="field-label">
              Cleaned up <span className="muted">(edit before using it, if need be)</span>
            </span>
            <textarea className="dev-text cleanup-text" value={text} onChange={(e) => setText(e.target.value)} aria-label="Cleaned-up notes" />
          </label>
          <p className="muted small">
            {modelLabel(result.model)} · {(result.ms / 1000).toFixed(1)} s · {money(result.costUsd)} · {tokensK(result.tokens.input + result.tokens.cacheRead)} in /{" "}
            {tokensK(result.tokens.output)} out
          </p>
        </>
      )}

      <button className="btn subtle cleanup-original-toggle" aria-expanded={showOriginal} onClick={() => setShowOriginal(!showOriginal)}>
        <span aria-hidden>{showOriginal ? "▾" : "▸"}</span> The notes as they are
      </button>
      {showOriginal && <pre className="cleanup-original">{s.notes}</pre>}

      <div className="row-actions">
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!result || busy || !text.trim()} onClick={accept}>
          Use these notes
        </button>
      </div>
    </Dialog>
  );
}
