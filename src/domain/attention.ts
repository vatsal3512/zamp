import type { RunSummary } from "@/pipeline/ports";

/** HOLD not yet resolved by a person, or ROUTE not yet signed off. */
export function needsAttention(r: RunSummary): boolean {
  if (r.outcome === "HOLD") return !r.override || r.override.action === "query_sent";
  if (r.outcome === "ROUTE_FOR_APPROVAL") return r.override?.action !== "sign_off" && r.override?.action !== "reject";
  return false;
}

export function filterRuns(runs: RunSummary[], opts: { needsAttention: boolean }): RunSummary[] {
  return opts.needsAttention ? runs.filter(needsAttention) : runs;
}
