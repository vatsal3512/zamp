import { describe, expect, it } from "vitest";
import { encodeSse, parseSseChunk } from "@/server/sse";
import { computeKpis } from "@/server/kpis";
import type { RunEvent } from "@/domain/types";
import type { RunSummary } from "@/pipeline/ports";

const ev = (seq: number): RunEvent => ({ runId: "r1", seq, stage: "intake", type: "finding", at: "2026-11-17T00:00:00Z", data: { text: `e${seq}` } });

describe("SSE", () => {
  it("round-trips events", () => {
    const text = [1, 2, 3].map((n) => encodeSse(ev(n))).join("");
    const { events, rest } = parseSseChunk(text);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(rest).toBe("");
  });

  it("keeps a partial event until the rest of it arrives", () => {
    const text = encodeSse(ev(1)) + encodeSse(ev(2));
    const cut = text.length - 10;
    const first = parseSseChunk(text.slice(0, cut));
    expect(first.events.map((e) => e.seq)).toEqual([1]);
    const second = parseSseChunk(first.rest + text.slice(cut));
    expect(second.events.map((e) => e.seq)).toEqual([2]);
  });
});

const run = (o: Partial<RunSummary>): RunSummary => ({
  id: "r", documentId: "d", source: "inbox", rerunOf: null, outcome: "APPROVE", startedAt: "", durationMs: 2000, model: null, cached: false,
  policyVersion: 1, invoiceId: null, invoiceNumber: null, vendorName: null, totalCents: 0, poNumber: null, primaryRule: null, summary: null,
  override: null, posted: false, ...o,
});

describe("computeKpis", () => {
  it("computes the ledger strip", () => {
    const k = computeKpis([
      run({ outcome: "APPROVE" }),
      run({ outcome: "APPROVE", override: { action: "approve", reason: "manual", at: "" } }),
      run({ outcome: "HOLD", totalCents: 125_559, primaryRule: "R-TOL-01" }),
      run({ outcome: "REJECT", totalCents: 240_000, primaryRule: "R-DUP-01" }),
    ]);
    expect(k).toMatchObject({ processed: 4, straightThroughPct: 0.25, needsAttentionCount: 1, heldCents: 125_559, protectedCents: 240_000, avgSeconds: 2, liveRuns: 4, aiCostPerInvoiceUsd: 0.001 });
  });

  it("averages time over live model calls, not instant cache replays", () => {
    const k = computeKpis([run({ durationMs: 5000 }), run({ durationMs: 200, cached: true }), run({ durationMs: 200, cached: true })]);
    expect(k).toMatchObject({ avgSeconds: 5, liveRuns: 1 });
    expect(computeKpis([run({ durationMs: 200, cached: true })])).toMatchObject({ avgSeconds: 0.2, liveRuns: 0 });
  });
});

describe("displayStatus", () => {
  it("shows a reviewer's resolution instead of the agent's hold", async () => {
    const { displayStatus } = await import("@/lib/status");
    expect(displayStatus({ outcome: "HOLD", override: { action: "approve" } })).toEqual({ label: "Resolved · approve", tone: "emerald" });
    expect(displayStatus({ outcome: "HOLD", override: { action: "reject" } })).toEqual({ label: "Resolved · reject", tone: "crimson" });
    expect(displayStatus({ outcome: "HOLD", override: { action: "query_sent" } })).toEqual({});
    expect(displayStatus({ outcome: "HOLD", override: null })).toEqual({});
  });
});

describe("liveRunHref", () => {
  it("gives every run start a fresh token, and only start queries start a run", async () => {
    const { liveRunHref, liveRunStart } = await import("@/lib/live-run");
    const a = liveRunHref({ inbox: "msg-ec4" }), b = liveRunHref({ inbox: "msg-ec4" });
    expect(a).not.toBe(b); // the same email processed twice must start two runs
    expect(liveRunStart(new URL(a, "http://x").searchParams)?.body).toEqual({ inboxMessageId: "msg-ec4", documentId: undefined, rerunOf: undefined });
    expect(liveRunStart(new URLSearchParams(""))).toBeNull(); // the rewritten /runs/<id> URL starts nothing
  });
});
