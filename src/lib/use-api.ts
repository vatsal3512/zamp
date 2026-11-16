"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** Bumped after mutations (reset, overrides, policy saves) so every mounted view refetches. */
export const RefreshContext = createContext<{ tick: number; bump: () => void }>({ tick: 0, bump: () => {} });
export const useRefresh = () => useContext(RefreshContext);

export function useApi<T>(url: string | null): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const { tick } = useRefresh();
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [local, setLocal] = useState(0);
  const reload = useCallback(() => setLocal((n) => n + 1), []);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
        if (alive) setState({ data: body as T, error: null, loading: false });
      })
      .catch((e: Error) => alive && setState((s) => ({ ...s, error: e.message, loading: false })));
    return () => {
      alive = false;
    };
  }, [url, tick, local]);

  return { ...state, reload };
}
