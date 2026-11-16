import type { RunSummary } from "@/pipeline/ports";
import { needsAttention } from "@/domain/attention";

export interface Kpis {
  processed: number; straightThroughPct: number; needsAttentionCount: number; heldCents: number;
  protectedCents: number; avgSeconds: number; aiCostUsd: number; manualBenchmarkUsd: number;
}

const PROTECTING_RULES = new Set(["R-DUP-01", "R-VEN-02", "R-VEN-03", "R-DOC-01"]);

export function computeKpis(runs: RunSummary[]): Kpis {
  const done = runs.filter((r) => r.outcome && r.outcome !== "FAILED");
  const attention = done.filter(needsAttention);
  const timed = done.filter((r) => r.durationMs != null);
  return {
    processed: done.length,
    straightThroughPct: done.length ? done.filter((r) => r.outcome === "APPROVE" && !r.override).length / done.length : 0,
    needsAttentionCount: attention.length,
    heldCents: attention.reduce((s, r) => s + (r.totalCents ?? 0), 0),
    protectedCents: done.filter((r) => r.primaryRule && PROTECTING_RULES.has(r.primaryRule)).reduce((s, r) => s + (r.totalCents ?? 0), 0),
    avgSeconds: timed.length ? timed.reduce((s, r) => s + r.durationMs!, 0) / timed.length / 1000 : 0,
    aiCostUsd: 0,
    manualBenchmarkUsd: 9.4,
  };
}
