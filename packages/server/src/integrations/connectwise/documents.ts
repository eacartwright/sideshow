import type { DB } from "../../db";
import type { FileStore } from "../../files";
import type { ConnectWiseClient } from "./client";

// A note's attachments go to the CW ticket its time is pushed to, as ticket documents
// (DESIGN.md §10). Each file goes to a ticket once: cw_documents remembers which went where,
// so pushing an entry again (Update…) doesn't attach them twice.

export interface Attachments {
  /** Upload whichever of these files the ticket doesn't have yet. Throws with a message to show. */
  ensureOnTicket(fileIds: string[], ticket: number, privateFlag: boolean): Promise<void>;
}

export class CwDocuments implements Attachments {
  constructor(
    private db: DB,
    private files: FileStore,
    private cw: ConnectWiseClient,
  ) {}

  async ensureOnTicket(fileIds: string[], ticket: number, privateFlag: boolean) {
    const known = this.db.prepare("SELECT 1 FROM cw_documents WHERE file_id = ? AND ticket = ?");
    const record = this.db.prepare("INSERT OR REPLACE INTO cw_documents (file_id, ticket, document_id) VALUES (?, ?, ?)");
    for (const id of fileIds) {
      if (known.get(id, ticket)) continue;
      const file = this.files.read(id);
      // A link to a file this server doesn't have (copied from elsewhere): nothing to send.
      if (!file) continue;
      try {
        const doc = await this.cw.uploadDocument(ticket, { name: file.info.name, type: file.info.type, data: file.data }, privateFlag);
        record.run(id, ticket, doc.id);
      } catch (err) {
        console.error(`attach ${file.info.name} to #${ticket}:`, err);
        throw new Error(`Couldn't attach ${file.info.name} to the ticket`);
      }
    }
  }
}
