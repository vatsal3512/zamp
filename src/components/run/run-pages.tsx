"use client";

import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { RunWorkspace } from "./run-workspace";
import type { RunSource } from "./use-run";

export function LiveRunPage() {
  const q = useSearchParams();
  // Freeze the starting query: the URL is later rewritten to /runs/<id>, which must not restart the run.
  const [start] = useState(() => ({ key: q.toString(), body: { inboxMessageId: q.get("inbox") ?? undefined, documentId: q.get("document") ?? undefined, rerunOf: q.get("rerunOf") ?? undefined } }));
  const source = useMemo<RunSource>(() => ({ kind: "live", body: start.body }), [start]);
  return <RunWorkspace key={start.key} source={source} />;
}

export function StoredRunPage() {
  const { id } = useParams<{ id: string }>();
  const source = useMemo<RunSource>(() => ({ kind: "stored", runId: id }), [id]);
  return <RunWorkspace key={id} source={source} />;
}
