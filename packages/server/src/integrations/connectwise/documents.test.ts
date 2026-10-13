import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId, type Op } from "@sideshow/shared";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../../db";
import { FileStore } from "../../files";
import { loadProfile } from "../../profile";
import { Store } from "../../store";
import type { ConnectWiseClient } from "./client";
import { CwDocuments } from "./documents";
import { cwNotes, pushSessions } from "./push";

const dirs: string[] = [];
const dbs: { close(): void }[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("notes for CW", () => {
  it("names attachments instead of linking to sideshow, and writes underline CW's way", () => {
    expect(
      cwNotes(
        "Printer offline at **FD2**\n\n- rebooted spooler\n- ++reinstalled driver++\n  ![screenshot.png](/api/files/abc/screenshot.png)\n\nSee [the log](/api/files/def/log.txt) and [docs](https://x.y)",
      ),
    ).toBe(
      "Printer offline at **FD2**\n\n- rebooted spooler\n- __reinstalled driver__\n  *Attachment: screenshot.png*\n\nSee *Attachment: the log* and [docs](https://x.y)",
    );
    expect(cwNotes("![](/api/files/abc/screen%20shot.png)")).toBe("*Attachment: screen shot.png*");
  });
});

function setup(failUpload = false) {
  const dir = mkdtempSync(join(tmpdir(), "sideshow-docs-"));
  dirs.push(dir);
  const db = openDb(join(dir, "t.db"));
  dbs.push(db);
  const store = new Store(db);
  const files = new FileStore(db, join(dir, "files"));
  const shot = files.save(new Uint8Array([137, 80, 78, 71]), "screenshot.png", "image/png");
  const run = (op: Op) => store.apply([{ id: newId(), at: Date.now(), op }]);
  run({ type: "list.create", itemId: "remote", list: "workTypes", name: "Remote - Business Hours" });
  run({ type: "task.create", taskId: "A", title: "Printer", fields: { ticket: "106745" } });
  run({ type: "session.create", sessionId: "a1", taskId: "A", start: Date.UTC(2026, 9, 12, 14), end: Date.UTC(2026, 9, 12, 15) });
  run({
    type: "session.update",
    sessionId: "a1",
    patch: { notes: `fixed it\n![screenshot.png](${FileStore.url(shot)})`, fields: { workType: "remote", billing: "Billable" } },
  });
  const docs: any[] = [];
  const entries: any[] = [];
  const cw = {
    getWorkTypes: async () => [{ id: 3, name: "Remote - Business Hours" }],
    ticketKind: async () => "ServiceTicket",
    uploadDocument: async (ticket: number, file: any, privateFlag: boolean) => {
      if (failUpload) throw new Error("CW said no");
      docs.push({ ticket, name: file.name, size: file.data.byteLength, privateFlag });
      return { id: 7000 + docs.length };
    },
    createTimeEntry: async (e: any) => {
      entries.push(e);
      return { id: 900 + entries.length };
    },
    updateTimeEntry: async (id: number) => ({ id }),
  } as unknown as ConnectWiseClient;
  const attachments = new CwDocuments(db, files, cw);
  const push = () => pushSessions(cw, store, loadProfile("veritaz-cw"), "ecartwright", ["a1"], attachments);
  return { db, store, docs, entries, push, run };
}

describe("pushing a note's attachments", () => {
  it("uploads them to the ticket (private for Internal notes) once, then makes the entry", async () => {
    const { docs, entries, push, run, db } = setup();
    expect(await push()).toMatchObject([{ ok: true, entryId: 901 }]);
    expect(docs).toEqual([{ ticket: 106745, name: "screenshot.png", size: 4, privateFlag: true }]);
    expect(entries[0].notes).toBe("fixed it\n*Attachment: screenshot.png*");
    expect(db.prepare("SELECT ticket, document_id FROM cw_documents").all()).toEqual([{ ticket: 106745, document_id: 7001 }]);
    // Edited and pushed again (Update…): the file isn't attached a second time.
    run({ type: "session.update", sessionId: "a1", patch: { deductMin: 5 } });
    expect(await push()).toMatchObject([{ ok: true, action: "updated" }]);
    expect(docs).toHaveLength(1);
  });

  it("makes no entry when a file can't be attached", async () => {
    const { entries, push, store } = setup(true);
    expect(await push()).toEqual([{ sessionId: "a1", ok: false, error: "Couldn't attach screenshot.png to the ticket" }]);
    expect(entries).toHaveLength(0);
    expect(store.state.sessions.a1!.enteredAt ?? null).toBeNull();
  });
});
