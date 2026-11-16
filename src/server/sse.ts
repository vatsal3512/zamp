import type { RunEvent } from "@/domain/types";

/** One run event as a Server-Sent Event frame. */
export function encodeSse(e: RunEvent): string {
  return `event: run\ndata: ${JSON.stringify(e)}\n\n`;
}

/** Parse as many complete frames as the buffer holds; return the unparsed remainder. Shared by server tests and the browser. */
export function parseSseChunk(buffer: string): { events: RunEvent[]; rest: string } {
  const events: RunEvent[] = [];
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  for (const frame of frames) {
    const data = frame.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
    if (data) events.push(JSON.parse(data) as RunEvent);
  }
  return { events, rest };
}
