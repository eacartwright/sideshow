import { useEffect, useRef, useState } from "react";
import { api, SignedOut } from "./sync";
import { showToast } from "./toast";

// Dictation (DESIGN.md §11): the phone's keyboard mic gets words wrong and there's nothing an app
// can do about it, so this records the audio itself and has the server transcribe it with a better
// model, told the words this job uses. The text arrives once you stop, not as you speak.

/** A long ramble is fine; a forgotten recording isn't. */
const MAX_MS = 15 * 60_000;

/** The first format this browser can record: the iPhone only does mp4. */
function recorderType(): string | undefined {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
}

export const canRecord = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

async function transcribe(blob: Blob, seconds: number, context: string): Promise<string> {
  const res = await api("/api/ai/transcribe", {
    method: "POST",
    headers: {
      // Without its ";codecs=…": the server names the file from this.
      "content-type": blob.type.split(";")[0] || "audio/webm",
      "x-seconds": String(Math.ceil(seconds)),
      "x-context": encodeURIComponent(context.slice(0, 200)),
    },
    body: blob,
  });
  return ((await res.json()) as { text: string }).text;
}

export type DictationState = "idle" | "starting" | "recording" | "sending";

/**
 * The record button's state. `onText` gets what was said. If sending fails the recording is kept,
 * with Try again in the message, so what was said isn't lost to a dropped connection.
 */
export function useDictation(onText: (text: string) => void, context: () => string) {
  const [state, setState] = useState<DictationState>("idle");
  const [startedAt, setStartedAt] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout>>(undefined);
  const textRef = useRef(onText);
  textRef.current = onText;

  const send = async (blob: Blob, seconds: number) => {
    setState("sending");
    try {
      const text = (await transcribe(blob, seconds, context())).trim();
      if (text) textRef.current(text);
      else showToast("Didn't catch any words in that");
      setState("idle");
    } catch (err) {
      setState("idle");
      if (err instanceof SignedOut) showToast("Signed out: reload to sign in. That recording couldn't be kept.");
      else if ((err as Error).message === "409") showToast("Dictation is stopped: AI is off, or this month's cap is spent (Settings › AI)");
      else showToast("Couldn't transcribe that", { label: "Try again", run: () => void send(blob, seconds) }, 60_000);
    }
  };

  const start = async () => {
    if (state !== "idle") return;
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("idle");
      showToast("The microphone is blocked for this app: allow it in the browser's settings");
      return;
    }
    const type = recorderType();
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const began = Date.now();
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      clearTimeout(limit.current);
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      void send(new Blob(chunks, { type: rec.mimeType || type || "audio/webm" }), (Date.now() - began) / 1000);
    };
    recorder.current = rec;
    rec.start();
    setStartedAt(began);
    setState("recording");
    limit.current = setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, MAX_MS);
  };

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  // Leaving the page mid-recording: let go of the microphone (and drop the audio).
  useEffect(
    () => () => {
      clearTimeout(limit.current);
      const rec = recorder.current;
      if (rec) {
        rec.onstop = null;
        if (rec.state === "recording") rec.stop();
        rec.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );

  return { state, startedAt, start, stop };
}
