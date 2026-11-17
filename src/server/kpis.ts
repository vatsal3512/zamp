import type { RunSummary } from "@/pipeline/ports";
import { needsAttention } from "@/domain/attention";

export interface Kpis {
  processed: number; straightThroughPct: number; needsAttentionCount: number; heldCents: number;
  protectedCents: number; avgSeconds: number; liveRuns: number; aiCostPerInvoiceUsd: number; manualBenchmarkUsd: number;
}

/**
 * Estimated model cost of one extraction at paid-tier Flash-Lite list prices (~3k input tokens for a page plus the
 * schema, ~1.5k output tokens). The demo runs on the free tier, so the actual bill is $0; this is the production figure.
 */
export const AI_COST_PER_INVOICE_USD = 0.001;

const PROTECTING_RULES = new Set(["R-DUP-01", "R-VEN-02", "R-VEN-03", "R-DOC-01"]);

export function computeKpis(runs: RunSummary[]): Kpis {
  const done = runs.filter((r) => r.outcome && r.outcome !== "FAILED");
  const attention = done.filter(needsAttention);
  // Average over runs that called the model when there are any; replays from the cache are much faster.
  const live = done.filter((r) => r.durationMs != null && !r.cached);
  const timed = live.length ? live : done.filter((r) => r.durationMs != null);
  return {
    processed: done.length,
    straightThroughPct: done.length ? done.filter((r) => r.outcome === "APPROVE" && !r.override).length / done.length : 0,
    needsAttentionCount: attention.length,
    heldCents: attention.reduce((s, r) => s + (r.totalCents ?? 0), 0),
    protectedCents: done.filter((r) => r.primaryRule && PROTECTING_RULES.has(r.primaryRule)).reduce((s, r) => s + (r.totalCents ?? 0), 0),
    avgSeconds: timed.length ? timed.reduce((s, r) => s + r.durationMs!, 0) / timed.length / 1000 : 0,
    liveRuns: live.length,
    aiCostPerInvoiceUsd: AI_COST_PER_INVOICE_USD,
    manualBenchmarkUsd: 9.4,
  };
}
