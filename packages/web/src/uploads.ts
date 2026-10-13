import { api, SignedOut } from "./sync";

// Attachments: a file pasted, dropped or picked in a note is sent to the server (POST
// /api/files), which keeps it and answers with where the note links to it. Needs the server:
// unlike edits, an upload isn't queued while offline.

export interface Uploaded {
  id: string;
  name: string;
  type: string;
  size: number;
  /** /api/files/<id>/<name>: what the note links to. */
  url: string;
}

/** The server's limit (files.ts MAX_FILE). */
export const MAX_UPLOAD = 25 * 1024 * 1024;

/** A pasted screenshot comes as "image.png": give it a name that says when. */
function nameFor(file: File): string {
  if (file.name && file.name !== "image.png") return file.name;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  return `screenshot-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

/** Upload a file; resolves to where it lives, or rejects with a message to show. */
export async function upload(file: File): Promise<Uploaded> {
  if (file.size > MAX_UPLOAD) throw new Error(`${file.name} is over ${MAX_UPLOAD / 1024 / 1024} MB`);
  try {
    const res = await api("/api/files", {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(nameFor(file)) },
      body: file,
    });
    return (await res.json()) as Uploaded;
  } catch (err) {
    if (err instanceof SignedOut) throw new Error("Signed out: reload to sign in, then attach it again");
    if ((err as Error).message === "413") throw new Error(`${file.name} is too big`);
    throw new Error("Couldn't upload it: check the connection and try again");
  }
}
