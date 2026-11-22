"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * How inbox runs read the invoice: "live" calls Gemini every time (recorded readings are only a fallback if the call
 * fails); "recorded" replays the stored reading for an instant, deterministic run. Remembered per browser.
 */
export type AiMode = "live" | "recorded";

const KEY = "ap.aiMode";
const listeners = new Set<() => void>();

function read(): AiMode {
  try {
    return localStorage.getItem(KEY) === "recorded" ? "recorded" : "live";
  } catch {
    return "live";
  }
}

export function useAiMode(): [AiMode, (m: AiMode) => void] {
  const mode = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    read,
    () => "live" as AiMode,
  );
  const set = useCallback((m: AiMode) => {
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
    listeners.forEach((l) => l());
  }, []);
  return [mode, set];
}
