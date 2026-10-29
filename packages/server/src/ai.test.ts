import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_AI, DEFAULT_TEMPLATE } from "@sideshow/shared";
import { Ai, AiStopped, parseAiSettings, type Ask } from "./ai";
import { openDb } from "./db";

const dirs: string[] = [];
const dbs: { close(): void }[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(providers: { anthropic?: Ask; openai?: Ask }) {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-ai-"));
  dirs.push(dir);
  const db = openDb(join(dir, "t.db"));
  dbs.push(db);
  return new Ai(db, providers);
}

/** A provider that answers in capitals, and remembers what it was asked. */
function fake(tokens = { input: 1_000_000, output: 100_000, cacheRead: 0 }) {
  const asked: { model: string; system: string; input: string }[] = [];
  const ask: Ask = async (model, system, input) => {
    asked.push({ model, system, input });
    return { text: input.split("The raw notes:\n\n")[1]!.toUpperCase(), tokens, note: "" };
  };
  return { ask, asked };
}

describe("AI cleanup", () => {
  it("sends the template and the notes, and records the cost", async () => {
    const claude = fake();
    const ai = setup({ anthropic: claude.ask });
    const r = await ai.cleanUp("rebooted printer", { context: "Printer offline" });
    expect(r.text).toBe("REBOOTED PRINTER");
    expect(r.model).toBe("claude-opus-5-5");
    // 1M in × $4 + 100K out × $20.
    expect(r.costUsd).toBeCloseTo(6);
    expect(claude.asked[0]!.system).toContain(DEFAULT_TEMPLATE.instructions);
    expect(claude.asked[0]!.input).toBe("About (for context only): Printer offline\n\nThe raw notes:\n\nrebooted printer");
    expect(ai.usage().calls).toBe(1);
    expect(ai.usage().byModel[0]).toMatchObject({ model: "claude-opus-5-5", calls: 1 });
  });

  it("uses another provider's model when named, if it has a key", async () => {
    const gpt = fake({ input: 1000, output: 1000, cacheRead: 0 });
    const ai = setup({ openai: gpt.ask });
    expect((await ai.cleanUp("x", { model: "gpt-6.1-sol" })).model).toBe("gpt-6.1-sol");
    await expect(ai.cleanUp("x")).rejects.toThrow("No ANTHROPIC_API_KEY on the server");
    expect(ai.available().map((m) => m.id)).toEqual(["gpt-6-luna", "gpt-6.1-terra", "gpt-6.1-sol"]);
  });

  it("stops at the monthly cap, and says which alerts a call crossed", async () => {
    const ai = setup({ anthropic: fake().ask });
    ai.saveSettings({ ...DEFAULT_AI, monthlyLimitUsd: 10, alertsAt: [50] });
    // $6 a call: the first crosses 50%, the second the cap; the third isn't made.
    expect((await ai.cleanUp("a")).alerts).toEqual([50]);
    expect((await ai.cleanUp("b")).alerts).toEqual([100]);
    await expect(ai.cleanUp("c")).rejects.toBeInstanceOf(AiStopped);
    expect(ai.usage().calls).toBe(2);
  });

  it("records a failed call, and refuses when off", async () => {
    const ai = setup({ anthropic: async () => Promise.reject(new Error("boom")) });
    await expect(ai.cleanUp("a")).rejects.toThrow("boom");
    expect(ai.usage().recent[0]).toMatchObject({ ok: false, costUsd: 0 });
    ai.saveSettings({ ...DEFAULT_AI, model: "off" });
    await expect(ai.cleanUp("a")).rejects.toThrow("AI is off");
  });

  it("picks the template asked for", async () => {
    const claude = fake();
    const ai = setup({ anthropic: claude.ask });
    ai.saveSettings({ ...DEFAULT_AI, templates: [DEFAULT_TEMPLATE, { id: "scope", name: "Scope", instructions: "A scope recommendation." }] });
    await ai.cleanUp("x", { templateId: "scope" });
    expect(claude.asked[0]!.system).toContain("A scope recommendation.");
    expect(claude.asked[0]!.system).not.toContain("Actions Taken");
  });

  it("checks settings from the app", () => {
    expect(parseAiSettings(DEFAULT_AI)).toEqual(DEFAULT_AI);
    expect(parseAiSettings({ ...DEFAULT_AI, model: "gpt-2" })).toEqual({ error: "Not a model" });
    expect(parseAiSettings({ ...DEFAULT_AI, templates: [] })).toEqual({ error: "At least one template is needed" });
    expect(parseAiSettings({ ...DEFAULT_AI, templates: [{ id: "a", name: "A", instructions: " " }] })).toEqual({ error: "Each template needs a name and instructions" });
    expect(parseAiSettings({ ...DEFAULT_AI, monthlyLimitUsd: null, alertsAt: [90, 50, 90] })).toMatchObject({ monthlyLimitUsd: null, alertsAt: [50, 90] });
  });
});
