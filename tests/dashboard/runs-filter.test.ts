import { describe, expect, it } from "vitest";
import { filterRuns, needsAttention } from "@/domain/attention";
import type { RunSummary } from "@/pipeline/ports";

const run = (id: string, o: Partial<RunSummary>): RunSummary => ({
  id, documentId: "d", source: "inbox", rerunOf: null, outcome: "APPROVE", startedAt: "", durationMs: 1, model: null, cached: false,
  policyVersion: 1, invoiceId: null, invoiceNumber: null, vendorName: null, totalCents: 0, poNumber: null, primaryRule: null, summary: null,
  override: null, posted: false, ...o,
});

describe("filterRuns / needsAttention", () => {
  const runs = [
    run("a", { outcome: "APPROVE" }),
    run("h", { outcome: "HOLD" }),
    run("h-resolved", { outcome: "HOLD", override: { action: "approve", reason: "ok", at: "" } }),
    run("h-queried", { outcome: "HOLD", override: { action: "query_sent", reason: "sent", at: "" } }),
    run("r", { outcome: "ROUTE_FOR_APPROVAL" }),
    run("r-signed", { outcome: "ROUTE_FOR_APPROVAL", override: { action: "sign_off", reason: "", at: "" } }),
    run("x", { outcome: "REJECT" }),
  ];

  it("keeps unresolved holds, queried holds and unsigned sign-offs", () => {
    expect(filterRuns(runs, { needsAttention: true }).map((r) => r.id)).toEqual(["h", "h-queried", "r"]);
  });

  it("returns everything for the All tab", () => {
    expect(filterRuns(runs, { needsAttention: false })).toHaveLength(7);
    expect(needsAttention(runs[0])).toBe(false);
  });
});
