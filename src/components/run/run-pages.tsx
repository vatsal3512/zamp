"use client";

import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { RunWorkspace } from "./run-workspace";
import type { RunSource } from "./use-run";
import { liveRunStart } from "@/lib/live-run";

export function LiveRunPage() {
  const q = useSearchParams();
  const requested = liveRunStart(new URLSearchParams(q.toString()));
  // The URL is later rewritten to /runs/<id> (no start query), which must not restart the run. But Next keeps this
  // page alive between visits, so a *new* start query (each link carries a fresh token) must start a new run.
  const [start, setStart] = useState(requested);
  if (requested && requested.key !== start?.key) setStart(requested);
  const source = useMemo<RunSource | null>(() => (start ? { kind: "live", body: start.body } : null), [start]);
  if (!start || !source) return null;
  return <RunWorkspace key={start.key} source={source} />;
}

export function StoredRunPage() {
  const { id } = useParams<{ id: string }>();
  const source = useMemo<RunSource>(() => ({ kind: "stored", runId: id }), [id]);
  return <RunWorkspace key={id} source={source} />;
}
