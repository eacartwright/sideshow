import Anthropic from "@anthropic-ai/sdk";
import OpenAI, { toFile } from "openai";
import {
  AI_MODELS,
  cleanupInput,
  cleanupSystem,
  costUsd,
  crossed,
  DEFAULT_AI,
  modelInfo,
  monthOf,
  TRANSCRIBE_MODEL,
  TRANSCRIBE_USD_PER_MIN,
  type AiProvider,
  type AiSettings,
  type AiTemplates,
  type AiTokens,
  type AiUsage,
  type CleanupResult,
} from "@sideshow/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadTemplates, TEMPLATES_DIR } from "./aiTemplates";
import type { DB } from "./db";

// AI note cleanup (DESIGN.md §11): a session's notes through Claude or GPT, from a template.
// The keys are ANTHROPIC_API_KEY and OPENAI_API_KEY in .env and never leave the server. One set
// of settings and one usage log for the whole server (the main workspace's database): every call
// is recorded with its estimated cost, and past the monthly cap no more calls are made.

const SETTINGS_KEY = "ai.settings";
/** Notes longer than this aren't sent (a day's notes are a few thousand characters). */
export const MAX_NOTES = 40_000;

export class AiStopped extends Error {}

/** One provider's call: instructions and input in, text and tokens out. */
export type Ask = (model: string, system: string, input: string) => Promise<{ text: string; tokens: AiTokens; note: string }>;

const askAnthropic = (client: Anthropic): Ask => async (model, system, input) => {
  const res = await client.messages.create({
    model,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: input }],
    // Tidying notes needs little thinking.
    output_config: { effort: "low" },
  });
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  const tokens = { input: res.usage.input_tokens, output: res.usage.output_tokens, cacheRead: res.usage.cache_read_input_tokens ?? 0 };
  return { text: res.stop_reason === "refusal" ? "" : text, tokens, note: res.stop_reason === "end_turn" ? "" : String(res.stop_reason) };
};

const askOpenAi = (client: OpenAI): Ask => async (model, system, input) => {
  const res = await client.responses.create({ model, instructions: system, input, reasoning: { effort: "low" }, max_output_tokens: 8000 });
  // OpenAI counts cached input inside input_tokens; the bill (and costUsd) counts them apart.
  const cached = res.usage?.input_tokens_details?.cached_tokens ?? 0;
  const tokens = { input: (res.usage?.input_tokens ?? 0) - cached, output: res.usage?.output_tokens ?? 0, cacheRead: cached };
  return { text: res.output_text.trim(), tokens, note: res.status === "completed" ? "" : String(res.status) };
};

/** Which providers have a key: their models can be picked. */
export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<Record<AiProvider, Ask>> {
  return {
    ...(env.ANTHROPIC_API_KEY ? { anthropic: askAnthropic(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })) } : {}),
    ...(env.OPENAI_API_KEY ? { openai: askOpenAi(new OpenAI({ apiKey: env.OPENAI_API_KEY })) } : {}),
  };
}

/** Speech to text: audio and the words to listen for in, text out. */
export type Transcribe = (audio: { data: Uint8Array; type: string }, hints: { prompt: string; keywords: string[] }) => Promise<string>;

/** A file name the API accepts, from what the browser recorded (the iPhone's is mp4). */
const AUDIO_EXT: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a" };

/** Dictation needs an OpenAI key (Anthropic has no speech to text). */
export function transcriberFromEnv(env: NodeJS.ProcessEnv = process.env): Transcribe | null {
  if (!env.OPENAI_API_KEY) return null;
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return async (audio, hints) => {
    const type = audio.type.split(";")[0]!;
    const file = await toFile(audio.data, `dictation.${AUDIO_EXT[type] ?? "webm"}`, { type });
    const res = await client.audio.transcriptions.create({
      file,
      model: TRANSCRIBE_MODEL,
      prompt: hints.prompt,
      ...(hints.keywords.length ? { keywords: hints.keywords } : {}),
    });
    return res.text;
  };
}

/** A provider's error, short enough to show and log. */
function errorNote(err: unknown): string {
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) return `${err.status ?? ""} ${err.message}`.trim().slice(0, 200);
  return "Couldn't reach the AI service";
}

export class Ai {
  constructor(
    private db: DB,
    private providers: Partial<Record<AiProvider, Ask>>,
    private templatesDir = TEMPLATES_DIR,
    private transcriber: Transcribe | null = null,
  ) {}

  /** Dictation can be used: there's a key for it. */
  canTranscribe(): boolean {
    return !!this.transcriber;
  }

  /** The words dictation should get right, from dictation-words.txt (read each time, like the templates). */
  dictationWords(): string[] {
    try {
      return readFileSync(join(this.templatesDir, "dictation-words.txt"), "utf8")
        .split(/\r?\n/)
        .map((l) => l.replace(/#.*/, "").trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Audio to text, for dictation. Under the same switch and monthly cap as cleanup, and in the same
   * usage log. Throws AiStopped when it can't run; a provider's error is recorded and rethrown.
   */
  async transcribe(audio: { data: Uint8Array; type: string }, opts: { seconds: number; words?: string[]; context?: string }): Promise<string> {
    if (!this.transcriber) throw new AiStopped("Dictation needs OPENAI_API_KEY on the server (.env)");
    const ai = this.settings();
    if (ai.model === "off") throw new AiStopped("AI is off (Settings › AI)");
    if (ai.monthlyLimitUsd !== null && this.monthSpend() >= ai.monthlyLimitUsd) throw new AiStopped(`This month's $${ai.monthlyLimitUsd} cap is spent (Settings › AI)`);
    const started = Date.now();
    const record = (cost: number, ok: boolean, note: string) =>
      this.db
        .prepare(
          "INSERT INTO ai_usage (at, month, model, purpose, input_tokens, output_tokens, cache_read_tokens, cost_usd, ok, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(started, monthOf(started), TRANSCRIBE_MODEL, "dictation", 0, 0, 0, cost, ok ? 1 : 0, note);
    const keywords = [...new Set([...this.dictationWords(), ...(opts.words ?? [])])].slice(0, 100);
    const prompt = `Spoken work notes from an IT technician at a managed service provider.${opts.context ? ` Working on: ${opts.context}.` : ""}`;
    try {
      const text = await this.transcriber(audio, { prompt, keywords });
      record((Math.max(opts.seconds, 0) / 60) * TRANSCRIBE_USD_PER_MIN, true, `${Math.round(opts.seconds)} s`);
      return text;
    } catch (err) {
      record(0, false, errorNote(err));
      throw err;
    }
  }

  /** The templates as the files say now (they're read every time); throws AiStopped if they're wrong. */
  templates(): AiTemplates {
    try {
      return loadTemplates(this.templatesDir);
    } catch (err) {
      throw new AiStopped((err as Error).message);
    }
  }

  /** Which providers have a key. */
  configured(): AiProvider[] {
    return Object.keys(this.providers) as AiProvider[];
  }

  settings(): AiSettings {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row) return DEFAULT_AI;
    // Templates were kept here until they moved to files (2026-10-29); old rows still have them.
    const { model, monthlyLimitUsd, alertsAt } = { ...DEFAULT_AI, ...(JSON.parse(row.value) as Partial<AiSettings>) };
    return { model, monthlyLimitUsd, alertsAt };
  }

  saveSettings(s: AiSettings) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SETTINGS_KEY, JSON.stringify(s));
  }

  monthSpend(month = monthOf(Date.now())): number {
    return (this.db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_usage WHERE month = ?").get(month) as { c: number }).c;
  }

  /**
   * Clean up notes with a template, on the settings' model unless another is named. Throws
   * AiStopped (said as is) when there's no key, AI is off or the month's cap is spent; any other
   * error is the provider's, recorded and rethrown.
   */
  async cleanUp(notes: string, opts: { templateId?: string; model?: string; context?: string; purpose?: string } = {}): Promise<CleanupResult> {
    const ai = this.settings();
    const model = opts.model ?? ai.model;
    if (model === "off") throw new AiStopped("AI is off (Settings › AI)");
    const info = modelInfo(model);
    if (!info) throw new AiStopped(`Not a model sideshow knows: ${model}`);
    const ask = this.providers[info.provider];
    if (!ask) throw new AiStopped(`No ${info.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} on the server (.env)`);
    const { rules, templates } = this.templates();
    const template = templates.find((t) => t.id === opts.templateId) ?? templates[0]!;
    const before = this.monthSpend();
    if (ai.monthlyLimitUsd !== null && before >= ai.monthlyLimitUsd) throw new AiStopped(`This month's $${ai.monthlyLimitUsd} cap is spent (Settings › AI)`);

    const started = Date.now();
    const record = (tokens: AiTokens, ok: boolean, note: string) => {
      const cost = costUsd(model, tokens);
      this.db
        .prepare(
          "INSERT INTO ai_usage (at, month, model, purpose, input_tokens, output_tokens, cache_read_tokens, cost_usd, ok, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(started, monthOf(started), model, opts.purpose ?? "cleanup", tokens.input, tokens.output, tokens.cacheRead, cost, ok ? 1 : 0, note);
      return cost;
    };
    let res;
    try {
      res = await ask(model, cleanupSystem(rules, template), cleanupInput(notes, opts.context));
    } catch (err) {
      record({ input: 0, output: 0, cacheRead: 0 }, false, errorNote(err));
      throw err;
    }
    const cost = record(res.tokens, !!res.text, res.text ? res.note : res.note || "no text");
    if (!res.text) throw new AiStopped(`${info.label} gave back nothing${res.note ? ` (${res.note})` : ""}`);
    return { text: res.text, model, costUsd: cost, tokens: res.tokens, ms: Date.now() - started, alerts: crossed(ai, before, before + cost) };
  }

  /** This month's use, for Settings › AI. */
  usage(now = Date.now()): AiUsage {
    const month = monthOf(now);
    type Row = { model: string; purpose: string; at: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number; ok: number; note: string };
    const rows = this.db.prepare("SELECT * FROM ai_usage WHERE month = ? ORDER BY at, id").all(month) as unknown as Row[];
    const tok = (r: Row): AiTokens => ({ input: r.input_tokens, output: r.output_tokens, cacheRead: r.cache_read_tokens });
    const add = (a: AiTokens, b: AiTokens): AiTokens => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead });
    const zero = (): AiTokens => ({ input: 0, output: 0, cacheRead: 0 });
    const byModel = new Map<string, AiUsage["byModel"][number]>();
    const byDay = new Map<number, number>();
    let tokens = zero();
    let cost = 0;
    for (const r of rows) {
      tokens = add(tokens, tok(r));
      cost += r.cost_usd;
      const m = byModel.get(r.model) ?? { model: r.model, costUsd: 0, calls: 0, tokens: zero() };
      byModel.set(r.model, { ...m, costUsd: m.costUsd + r.cost_usd, calls: m.calls + 1, tokens: add(m.tokens, tok(r)) });
      const day = new Date(r.at).getDate();
      byDay.set(day, (byDay.get(day) ?? 0) + r.cost_usd);
    }
    return {
      month,
      costUsd: cost,
      tokens,
      calls: rows.length,
      byModel: [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd),
      byDay: [...byDay].map(([day, c]) => ({ day, costUsd: c })),
      recent: rows
        .slice(-8)
        .reverse()
        .map((r) => ({ at: r.at, model: r.model, purpose: r.purpose, costUsd: r.cost_usd, tokens: tok(r), ok: !!r.ok, note: r.note })),
    };
  }

  /** The models that can be used now (their provider has a key). */
  available() {
    return AI_MODELS.filter((m) => this.providers[m.provider]);
  }
}

/** Settings as the app sends them, checked; or what's wrong with them. */
export function parseAiSettings(b: any): AiSettings | { error: string } {
  if (typeof b?.model !== "string" || (b.model !== "off" && !modelInfo(b.model))) return { error: "Not a model" };
  const cap = b.monthlyLimitUsd;
  if (cap !== null && !(typeof cap === "number" && cap >= 0 && cap <= 1000)) return { error: "The cap is a number of dollars (up to 1000), or none" };
  if (!Array.isArray(b.alertsAt) || b.alertsAt.some((p: unknown) => !Number.isInteger(p) || (p as number) < 1 || (p as number) > 99)) return { error: "Alerts are percentages" };
  return { model: b.model, monthlyLimitUsd: cap, alertsAt: [...new Set(b.alertsAt as number[])].sort((x, y) => x - y) };
}
