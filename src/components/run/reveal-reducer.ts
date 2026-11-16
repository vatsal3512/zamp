import type { RunEvent } from "@/domain/types";

/**
 * Paced playback of run events. The server emits at true speed (deterministic stages take a few ms);
 * the viewer reveals one stage per `minDwellMs` so each step is readable. True durations are still displayed.
 */
export interface RevealState { queue: RunEvent[]; shown: RunEvent[]; lastRevealAt: number; minDwellMs: number }
export type RevealAction = { type: "enqueue"; events: RunEvent[] } | { type: "tick"; now: number } | { type: "flush" } | { type: "reset" };

export const initialReveal = (minDwellMs = 300): RevealState => ({ queue: [], shown: [], lastRevealAt: -Infinity, minDwellMs });

export function revealReducer(s: RevealState, a: RevealAction): RevealState {
  if (a.type === "enqueue") {
    const seen = new Set([...s.shown, ...s.queue].map((e) => e.seq));
    const fresh = a.events.filter((e) => !seen.has(e.seq));
    return fresh.length ? { ...s, queue: [...s.queue, ...fresh].sort((x, y) => x.seq - y.seq) } : s;
  }
  if (a.type === "flush") return { ...s, shown: [...s.shown, ...s.queue], queue: [] };
  if (a.type === "reset") return initialReveal(s.minDwellMs);

  if (!s.queue.length) return s;
  const queue = [...s.queue];
  const shown = [...s.shown];
  let lastRevealAt = s.lastRevealAt;
  while (queue.length) {
    const next = queue[0];
    if (next.type === "started") {
      if (shown.length && a.now - lastRevealAt < s.minDwellMs) break;
      lastRevealAt = a.now;
    }
    shown.push(queue.shift()!);
  }
  return shown.length === s.shown.length ? s : { ...s, queue, shown, lastRevealAt };
}
