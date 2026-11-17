"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** Bumped after mutations (reset, overrides, policy saves) so every mounted view refetches. */
export const RefreshContext = createContext<{ tick: number; bump: () => void }>({ tick: 0, bump: () => {} });
export const useRefresh = () => useContext(RefreshContext);

export function useApi<T>(url: string | null): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const { tick } = useRefresh();
  const [local, setLocal] = useState(0);
  const reload = useCallback(() => setLocal((n) => n + 1), []);
  const key = `${url}|${tick}|${local}`;
  // Keeps the last data while a refetch runs; "loading" means the stored response is for an older request.
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });

  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `Request failed (${r.status})`);
        if (alive) setState({ key, data: body as T, error: null });
      })
      .catch((e: Error) => alive && setState((s) => ({ ...s, key, error: e.message })));
    return () => {
      alive = false;
    };
  }, [url, key]);

  return { data: state.data, error: state.error, loading: !!url && state.key !== key, reload };
}
