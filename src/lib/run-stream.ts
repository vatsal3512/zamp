import type { RunEvent } from "@/domain/types";
import { parseSseChunk } from "@/server/sse";

/** POST /api/runs and deliver events as they stream in. Rejects with the server's message on HTTP errors. */
export async function streamRun(
  body: { inboxMessageId?: string; documentId?: string; rerunOf?: string; fresh?: boolean },
  onEvents: (events: RunEvent[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/runs", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, signal });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `Could not start the run (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;
    if (events.length) onEvents(events);
    if (done) break;
  }
}
