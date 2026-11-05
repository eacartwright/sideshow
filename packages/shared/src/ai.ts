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

/**
 * Dictation's model (OpenAI). Billed by the minute, not by the token; list price checked
 * 2026-11-04 (gpt-4o-transcribe is deprecated in its favor).
 */
export const TRANSCRIBE_MODEL = "gpt-transcribe";
export const TRANSCRIBE_USD_PER_MIN = 0.0045;

export const PROVIDER_NAMES: Record<AiProvider, string> = { anthropic: "Anthropic", openai: "OpenAI" };

export const modelInfo = (id: string) => AI_MODELS.find((m) => m.id === id);
export const modelLabel = (id: string) => modelInfo(id)?.label ?? id;

/**
 * A way of cleaning up notes: its name, and what the model is told about the shape it wants.
 * From packages/server/ai-templates/ (a Markdown file each), not from the settings.
 */
export interface AiTemplate {
  id: string;
  name: string;
  instructions: string;
}

/** The templates and the rules they all go with, as the files say (or what's wrong with them). */
export interface AiTemplates {
  rules: string;
  /** The first is the default. */
  templates: AiTemplate[];
}

export interface AiSettings {
  /** A model id, or "off". */
  model: string;
  /** Dollars a calendar month; past it the server makes no more calls. Null = no cap. */
  monthlyLimitUsd: number | null;
  /** Percentages of the cap that raise an alert when a call crosses them. */
  alertsAt: number[];
}

export const DEFAULT_AI: AiSettings = { model: "claude-opus-5-5", monthlyLimitUsd: 5, alertsAt: [75, 90] };

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

/** What the model is told, as its instructions (system prompt): the rules, then the template. */
export const cleanupSystem = (rules: string, t: AiTemplate) => `${rules}\n\nThe shape of the notes:\n\n${t.instructions}`;

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
