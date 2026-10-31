import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Op } from "@sideshow/shared";
import { openDb, type DB } from "./db";
import { Push, type PushPayload } from "./push";
import { Store } from "./store";

const T0 = Date.UTC(2026, 9, 31, 13);
let n = 0;
const op = (o: Op, at = T0) => ({ id: `op${n++}`, at, op: o });
const sub = (id: string) => ({ endpoint: `https://push.example/${id}`, keys: { p256dh: "p", auth: "a" } });

let dir: string;
let db: DB;
let store: Store;
let push: Push;
let sent: { endpoint: string; payload: PushPayload }[];
let status: number;

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  dir = mkdtempSync(join(tmpdir(), "sideshow-push-"));
  db = openDb(join(dir, "t.db"));
  store = new Store(db);
  sent = [];
  status = 201;
  push = new Push(join(dir, "push.json"), () => {}, async (s, body) => {
    sent.push({ endpoint: s.endpoint, payload: JSON.parse(body) });
    return status;
  });
  push.watch("main", store);
});
afterEach(() => {
  push.close();
  db.close();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const startTask = (title: string, at = T0) =>
  store.apply([op({ type: "task.start", taskId: `t-${title}`, sessionId: `s-${title}-${at}`, newTask: { title } }, at)]);
const settle = () => vi.advanceTimersByTimeAsync(5000);

describe("push", () => {
  it("makes VAPID keys once and keeps subscriptions in push.json", () => {
    const file = join(dir, "push.json");
    expect(existsSync(file)).toBe(true);
    expect(push.subscribe(sub("a"), "main", "https://sideshow.evans.tools")).toEqual({ running: true, remindHours: 3 });
    const again = new Push(file, () => {}, async () => 201);
    expect(again.publicKey).toBe(push.publicKey);
    expect(again.has(sub("a").endpoint)).toBe(true);
    again.close();
    expect(JSON.parse(readFileSync(file, "utf8")).subscriptions[0].workspace).toBe("main");
  });

  it("refuses something that isn't a subscription", () => {
    expect(push.subscribe({ endpoint: "http://x" }, "main", "")).toBeNull();
    expect(push.subscribe(null, "main", "")).toBeNull();
  });

  it("keeps a device's choices when it subscribes again without them", () => {
    push.subscribe(sub("a"), "main", "", { running: false, remindHours: 1 });
    expect(push.subscribe(sub("a"), "other", "")).toEqual({ running: false, remindHours: 1 });
  });

  it("sends what's running once things settle, then what stopped", async () => {
    push.subscribe(sub("a"), "main", "");
    push.subscribe(sub("b"), "elsewhere", "");
    startTask("Printer");
    expect(sent).toEqual([]);
    await settle();
    expect(sent).toEqual([{ endpoint: sub("a").endpoint, payload: { kind: "running", running: [{ title: "Printer", start: T0 }], paused: [], stopped: [] } }]);

    // Notes being typed don't change what's running: nothing sent.
    store.apply([op({ type: "session.update", sessionId: `s-Printer-${T0}`, patch: { notes: "hi" } })]);
    await settle();
    expect(sent).toHaveLength(1);

    store.apply([op({ type: "timer.stop" }, T0 + 60_000)]);
    await settle();
    expect(sent[1]!.payload).toEqual({ kind: "running", running: [], paused: [], stopped: ["Printer"] });
  });

  it("makes a switch one push, and says what's paused", async () => {
    push.subscribe(sub("a"), "main", "");
    startTask("One");
    await settle();
    startTask("Two", T0 + 60_000);
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.payload.running.map((r) => r.title)).toEqual(["Two"]);
    store.apply([op({ type: "timer.pause" }, T0 + 120_000)]);
    await settle();
    expect(sent[2]!.payload).toMatchObject({ running: [], paused: ["Two", "One"] });
  });

  it("doesn't send to devices that only want reminders", async () => {
    push.subscribe(sub("a"), "main", "", { running: false, remindHours: 2 });
    startTask("Long");
    await settle();
    expect(sent).toEqual([]);
  });

  it("reminds every remindHours a timer runs, once each", () => {
    push.subscribe(sub("a"), "main", "", { running: false, remindHours: 2 });
    startTask("Long");
    push.remind(T0 + 3_600_000);
    expect(sent).toEqual([]);
    push.remind(T0 + 2 * 3_600_000);
    push.remind(T0 + 2 * 3_600_000 + 60_000);
    expect(sent.map((s) => s.payload.kind)).toEqual(["reminder"]);
    push.remind(T0 + 4 * 3_600_000);
    expect(sent).toHaveLength(2);
  });

  it("drops a subscription the push service says is gone", async () => {
    push.subscribe(sub("a"), "main", "");
    status = 410;
    startTask("X");
    await settle();
    expect(push.has(sub("a").endpoint)).toBe(false);
  });

  it("sends a test to a subscribed device", async () => {
    push.subscribe(sub("a"), "main", "");
    expect(await push.test(sub("a").endpoint)).toBe(true);
    expect(sent[0]!.payload.kind).toBe("test");
    expect(await push.test(sub("nope").endpoint)).toBe(false);
  });
});
