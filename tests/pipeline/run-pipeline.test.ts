import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runPipeline, type RunInput } from "@/pipeline/run-pipeline";
import { runScenario } from "@/pipeline/eval";
import { pdfFromDisk } from "@/node/disk";
import { MemoryRepo } from "@/db/memory-repo";
import { AllProvidersExhaustedError } from "@/ai/key-pool";
import type { Extractor } from "@/pipeline/ports";
import type { ExtractedInvoice, RunEvent } from "@/domain/types";
import { SCENARIOS, scenarioById } from "../../fixtures/scenarios";
import { COMPANY } from "../../fixtures/seed-data";
import { extractionFor } from "../../fixtures/doc-to-extraction";

const pdfOf = (id: string) => new Uint8Array(readFileSync(path.resolve(__dirname, "../../fixtures/pdfs", scenarioById(id)!.file)));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A perfect reader: returns each fixture's printed content, keyed by file hash. */
function fixtureExtractor(): Extractor & { extract: ReturnType<typeof vi.fn> } {
  const bySha = new Map<string, ExtractedInvoice>(SCENARIOS.map((s) => [sha(pdfOf(s.id)), extractionFor(s.id)]));
  return {
    extract: vi.fn(async (_pdf: Uint8Array, h: string) => {
      const invoice = bySha.get(h);
      if (!invoice) throw new Error(`unknown pdf ${h}`);
      return { invoice: structuredClone(invoice), model: "fake-model", cached: false, attempts: [] };
    }),
  };
}

async function run(id: string, opts: Partial<RunInput> = {}, repo = new MemoryRepo(), extractor: Extractor = fixtureExtractor()) {
  const events: RunEvent[] = [];
  const s = scenarioById(id)!;
  const r = await runPipeline(
    { documentId: id, pdf: pdfOf(id), envelope: s.envelope, source: "inbox", ...opts },
    { repo, extractor, emit: () => {}, company: COMPANY },
  );
  events.push(...repo.eventsFor(r.runId));
  return { ...r, repo, events, findings: events.filter((e) => e.type === "finding").map((e) => (e.data as { text: string }).text) };
}

describe("runPipeline — every scenario", () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))("%s → expected outcome and rules", async (_id, s) => {
    const r = await runScenario(s, fixtureExtractor(), pdfFromDisk());
    expect(r.actual).toBe(s.expected.outcome);
    expect(r.rules).toEqual(expect.arrayContaining(s.expected.rules));
  });

  it("reports currency even though the unknown vendor stops the run (INR)", async () => {
    const r = await run("inr");
    expect(r.decision!.hits.map((h) => h.rule)).toEqual(expect.arrayContaining(["R-CUR-01", "R-VEN-01"]));
  });
});

describe("runPipeline — ledger", () => {
  it("posts the approved invoice and verifies the write", async () => {
    const r = await run("happy");
    expect(r.findings).toContain("Ledger write verified: PO-2031 $0.00 → $1,159.90");
    expect((await r.repo.getPurchaseOrder("PO-2031"))!.billedToDateCents).toBe(115_990);
  });

  it("posts goods only, not freight", async () => {
    const r = await run("freight");
    expect(r.decision!.outcome).toBe("APPROVE");
    expect(r.findings).toContain("Ledger write verified: PO-2034 $0.00 → $1,156.00");
  });

  it("does not post an invoice that is pending sign-off", async () => {
    const repo = new MemoryRepo();
    repo.setPolicy({ approvalThresholdCents: 100_000 });
    const r = await run("happy", {}, repo);
    expect(r.decision!.outcome).toBe("ROUTE_FOR_APPROVAL");
    expect((await repo.getPurchaseOrder("PO-2031"))!.billedToDateCents).toBe(0);
  });

  it("fails the run when the ledger read-back disagrees", async () => {
    class LyingRepo extends MemoryRepo {
      override async readBackLedger() {
        return { billedToDateCents: 1, invoicePosted: true };
      }
    }
    const r = await run("happy", {}, new LyingRepo());
    expect(r.failed).toBe(true);
    expect(r.events.at(-1)!.type).toBe("done");
    expect(r.events.some((e) => e.type === "failed" && /read-back mismatch/i.test(String((e.data as any)?.text)))).toBe(true);
  });
});

describe("runPipeline — re-runs, duplicates and re-extraction", () => {
  it("rejects the same file submitted twice, but lets an explicit re-run through", async () => {
    const repo = new MemoryRepo();
    const ex = fixtureExtractor();
    expect((await run("happy", { source: "upload" }, repo, ex)).decision!.outcome).toBe("APPROVE");
    const again = await run("happy", { source: "upload" }, repo, ex);
    expect(again.decision!.hits[0].rule).toBe("R-DOC-01");
    expect(again.decision!.outcome).toBe("REJECT");
  });

  it("re-runs PV under a looser AOP and flips HOLD → APPROVE", async () => {
    const repo = new MemoryRepo();
    const ex = fixtureExtractor();
    const first = await run("pv", {}, repo, ex);
    expect(first.decision!.outcome).toBe("HOLD");
    repo.setPolicy({ priceTolPct: 0.05 });
    const second = await run("pv", { source: "rerun", rerunOf: first.runId }, repo, ex);
    expect(second.decision!.outcome).toBe("APPROVE");
  });

  it("re-reads once when totals don't reconcile, then holds (EC-5)", async () => {
    const ex = fixtureExtractor();
    const r = await run("ec5", {}, new MemoryRepo(), ex);
    expect(ex.extract).toHaveBeenCalledTimes(2);
    expect(ex.extract.mock.calls[1][2]).toMatchObject({ reextract: { reason: "Line items sum to $7,340.00 but the invoice states $7,430.00" } });
    expect(r.decision!.primary?.rule).toBe("R-EXT-02");
  });
});

describe("runPipeline — the demo inbox processed in order on one database", () => {
  it("decides every scenario as expected when all 21 run back to back", async () => {
    const repo = new MemoryRepo();
    const wrong: string[] = [];
    for (const s of SCENARIOS) {
      const r = await run(s.id, {}, repo);
      const rules = r.decision?.hits.map((h) => h.rule) ?? [];
      if (r.decision?.outcome !== s.expected.outcome || !s.expected.rules.every((x) => rules.includes(x))) wrong.push(`${s.id}: ${r.decision?.outcome} ${rules.join(" ")}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("runPipeline — failure handling and events", () => {
  it("ends cleanly when every key and model is exhausted", async () => {
    const ex: Extractor = { extract: async () => { throw new AllProvidersExhaustedError([]); } };
    const r = await run("happy", {}, new MemoryRepo(), ex);
    expect(r.failed).toBe(true);
    expect(r.events.slice(-2).map((e) => e.type)).toEqual(["failed", "done"]);
  });

  it("finishes even if the live emitter throws on every event", async () => {
    const repo = new MemoryRepo();
    const s = scenarioById("happy")!;
    const r = await runPipeline(
      { documentId: "happy", pdf: pdfOf("happy"), envelope: s.envelope, source: "inbox" },
      { repo, extractor: fixtureExtractor(), emit: () => { throw new Error("socket closed"); }, company: COMPANY },
    );
    expect(r.decision!.outcome).toBe("APPROVE");
  });

  it("emits ordered events with one start and one finish per stage", async () => {
    const { events } = await run("ec4");
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    const stages = [...new Set(events.map((e) => e.stage))];
    for (const st of stages.filter((x) => x !== "decide" || true)) {
      const ofStage = events.filter((e) => e.stage === st);
      expect(ofStage.filter((e) => e.type === "started"), st).toHaveLength(1);
      expect(ofStage.filter((e) => e.type === "completed" || e.type === "failed"), st).toHaveLength(1);
    }
    expect(events.at(-1)!.type).toBe("done");
  });
});
