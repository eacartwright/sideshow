// AI note cleanup (DESIGN.md §11): a session's raw notes rewritten by a model, from a template,
// before they're pushed. Claude (Anthropic) or GPT (OpenAI), whichever keys the server has; the
// model is picked in Settings › AI. The keys never leave the server. Settings and usage are one
// set for the whole server (one bill), not per workspace.

export type AiProvider = "anthropic" | "openai";

export interface AiModelInfo {
  id: string;
  provider: AiProvider;
  label: string;
  /** Dollars per million tokens, list prices (checked on both providers' pages 2026-10-29). */
  input: number;
  output: number;
  cacheRead: number;
}

export const AI_MODELS: AiModelInfo[] = [
  { id: "claude-haiku-5-5", provider: "anthropic", label: "Claude Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.01 },
  { id: "claude-sonnet-5-5", provider: "anthropic", label: "Claude Sonnet 5.5", input: 2, output: 10, cacheRead: 0.1 },
  { id: "claude-opus-5-5", provider: "anthropic", label: "Claude Opus 5.5", input: 4, output: 20, cacheRead: 0.2 },
  { id: "gpt-6-luna", provider: "openai", label: "GPT-6 Luna", input: 0.1, output: 0.5, cacheRead: 0.01 },
  { id: "gpt-6.1-terra", provider: "openai", label: "GPT-6.1 Terra", input: 1, output: 5, cacheRead: 0.05 },
  { id: "gpt-6.1-sol", provider: "openai", label: "GPT-6.1 Sol", input: 2, output: 10, cacheRead: 0.1 },
];

export const PROVIDER_NAMES: Record<AiProvider, string> = { anthropic: "Anthropic", openai: "OpenAI" };

export const modelInfo = (id: string) => AI_MODELS.find((m) => m.id === id);
export const modelLabel = (id: string) => modelInfo(id)?.label ?? id;

/** A way of cleaning up notes: its name, and what the model is told about the shape it wants. */
export interface AiTemplate {
  id: string;
  name: string;
  instructions: string;
}

export interface AiSettings {
  /** A model id, or "off". */
  model: string;
  /** Dollars a calendar month; past it the server makes no more calls. Null = no cap. */
  monthlyLimitUsd: number | null;
  /** Percentages of the cap that raise an alert when a call crosses them. */
  alertsAt: number[];
  /** At least one; the first is the default. */
  templates: AiTemplate[];
}

export const DEFAULT_TEMPLATE: AiTemplate = {
  id: "actions-communication-next",
  name: "Actions Taken / Communication / Next Steps",
  instructions: `Three sections, in this order, each a bold heading on its own line followed by "- " bullets:

**Actions Taken**
What was done, in the order it was done: checks, findings, changes, results.

**Communication**
Who was contacted or updated, how, and what was said or agreed.

**Next Steps**
What's left to do, and who is doing it.

Leave out a section with nothing in it.`,
};

export const DEFAULT_AI: AiSettings = { model: "claude-opus-5-5", monthlyLimitUsd: 5, alertsAt: [75, 90], templates: [DEFAULT_TEMPLATE] };

/** Tokens as both providers' bills count them: input excludes the cached part. */
export interface AiTokens {
  input: number;
  output: number;
  cacheRead: number;
}

export function costUsd(model: string, t: AiTokens): number {
  const p = modelInfo(model);
  if (!p) return 0;
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead) / 1_000_000;
}

/** The alert levels (and 100%, the cap) a call moving spend from `before` to `after` crossed. */
export function crossed(ai: Pick<AiSettings, "monthlyLimitUsd" | "alertsAt">, before: number, after: number): number[] {
  const cap = ai.monthlyLimitUsd;
  if (!cap) return [];
  return [...ai.alertsAt, 100].filter((pct, i, all) => all.indexOf(pct) === i && before < (cap * pct) / 100 && after >= (cap * pct) / 100);
}

/** The general rules every template goes with. The template says what shape the note takes. */
export const CLEANUP_RULES = `You tidy a technician's raw working notes into the notes of one time entry in a PSA (ConnectWise), at an IT managed service provider. The notes are read by colleagues and sometimes by the client.

- Keep every fact: names, devices, error messages, numbers, times, what was tried and what happened. Don't add anything that isn't in the notes: no guesses, causes, advice or steps that weren't taken.
- Write plainly and briefly, in the past tense for what was done. Fix spelling and grammar; expand shorthand only when its meaning is certain.
- Markdown: **bold**, "- " bullets, "1. " numbers. Keep every picture or link exactly as written (![…](…) or […](…)), each where it belongs.
- Answer with the cleaned-up notes only: no preamble, no title, no remarks about them.

The shape of the notes:

`;

/** What the model is told, as its instructions (system prompt). */
export const cleanupSystem = (t: AiTemplate) => CLEANUP_RULES + t.instructions;

/** What the model is given: the notes, and what they're about (not to be repeated). */
export function cleanupInput(notes: string, context?: string): string {
  return `${context ? `About (for context only): ${context}\n\n` : ""}The raw notes:\n\n${notes}`;
}

/** This month's use, for Settings › AI (GET /api/ai). */
export interface AiUsage {
  month: string;
  costUsd: number;
  tokens: AiTokens;
  calls: number;
  byModel: { model: string; costUsd: number; calls: number; tokens: AiTokens }[];
  byDay: { day: number; costUsd: number }[];
  recent: { at: number; model: string; purpose: string; costUsd: number; tokens: AiTokens; ok: boolean; note: string }[];
}

/** What a cleanup answers. */
export interface CleanupResult {
  text: string;
  model: string;
  costUsd: number;
  tokens: AiTokens;
  ms: number;
  /** Alert levels (% of the cap) this call crossed. */
  alerts: number[];
}

export const monthOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
