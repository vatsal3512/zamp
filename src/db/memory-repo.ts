import type { Cents, Decision, ExtractedInvoice, Outcome, Policy, PriorInvoice, RunEvent } from "@/domain/types";
import type { Repo } from "@/pipeline/ports";
import { toCents } from "@/domain/money";
import { SEED, type SeedData } from "../../fixtures/seed-data";

export interface StoredInvoice {
  id: string; runId: string; documentId: string; sha256: string; vendorId: string | null; poNumber: string | null;
  extracted: ExtractedInvoice | null; decision: Decision; posted: boolean; postedAmountCents: Cents;
}
export interface StoredRun {
  id: string; documentId: string; source: "inbox" | "upload" | "rerun"; rerunOf?: string; policyVersion: number;
  startedAt: string; outcome: Outcome | "FAILED" | null; durationMs: number | null; model: string | null; cached: boolean;
}

/** In-memory Repo for tests, eval and REPO=memory dev mode. */
export class MemoryRepo implements Repo {
  protected state!: SeedData;
  readonly runs = new Map<string, StoredRun>();
  readonly invoices = new Map<string, StoredInvoice>();
  readonly events: RunEvent[] = [];
  private n = 0;

  constructor(private seed: SeedData = SEED) {
    this.reset();
  }

  reset(): void {
    this.state = structuredClone(this.seed);
    this.runs.clear();
    this.invoices.clear();
    this.events.length = 0;
  }

  setPolicy(p: Partial<Policy>): void {
    this.state.policy = { ...this.state.policy, ...p, version: this.state.policy.version + 1 };
  }

  eventsFor(runId: string): RunEvent[] {
    return this.events.filter((e) => e.runId === runId);
  }

  private id(prefix: string) {
    return `${prefix}-${++this.n}`;
  }

  async getPolicy() { return structuredClone(this.state.policy); }
  async getVendors() { return structuredClone(this.state.vendors); }
  async getPurchaseOrder(poNumber: string) { return structuredClone(this.state.purchaseOrders.find((p) => p.poNumber === poNumber) ?? null); }
  async getOpenPurchaseOrders(vendorId: string) {
    return structuredClone(this.state.purchaseOrders.filter((p) => p.vendorId === vendorId && p.status === "open"));
  }
  async getGoodsReceipts(poNumber: string) { return structuredClone(this.state.goodsReceipts.filter((g) => g.poNumber === poNumber)); }
  async getPriorInvoices(vendorId: string) { return structuredClone(this.state.priorInvoices.filter((p) => p.vendorId === vendorId)); }
  async findAcceptedInvoiceByHash(sha256: string) {
    return structuredClone(this.state.priorInvoices.find((p) => p.sha256 === sha256 && (p.outcome === "APPROVE" || p.outcome === "ROUTE_FOR_APPROVAL")) ?? null);
  }

  async saveInvoiceResult(r: Parameters<Repo["saveInvoiceResult"]>[0]) {
    const id = this.id("inv");
    this.invoices.set(id, { id, ...structuredClone(r), posted: false, postedAmountCents: 0 });
    const x = r.extracted;
    const accepted = r.decision.outcome === "APPROVE" || r.decision.outcome === "ROUTE_FOR_APPROVAL";
    if (accepted && x && r.vendorId) {
      const prior: PriorInvoice = {
        invoiceId: id, vendorId: r.vendorId, invoiceNumber: x.invoiceNumber.value ?? "", invoiceDate: x.invoiceDate.value ?? "",
        totalCents: x.total.value === null ? 0 : toCents(x.total.value), servicePeriod: x.servicePeriod.value,
        lineDescriptions: x.lines.map((l) => l.description ?? "").filter(Boolean), outcome: r.decision.outcome, sha256: r.sha256,
      };
      this.state.priorInvoices.push(prior);
    }
    return { invoiceId: id };
  }

  async postToLedger(poNumber: string, invoiceId: string, amountCents: Cents) {
    const po = this.state.purchaseOrders.find((p) => p.poNumber === poNumber);
    const inv = this.invoices.get(invoiceId);
    if (!po || !inv) throw new Error(`Cannot post ${invoiceId} to ${poNumber}`);
    const beforeCents = po.billedToDateCents;
    po.billedToDateCents += amountCents;
    inv.posted = true;
    inv.postedAmountCents = amountCents;
    return { beforeCents, afterCents: po.billedToDateCents };
  }

  async readBackLedger(poNumber: string, invoiceId: string) {
    const po = this.state.purchaseOrders.find((p) => p.poNumber === poNumber);
    return { billedToDateCents: po?.billedToDateCents ?? 0, invoicePosted: this.invoices.get(invoiceId)?.posted ?? false };
  }

  async createRun(r: Parameters<Repo["createRun"]>[0]) {
    const id = this.id("run");
    this.runs.set(id, { id, ...r, startedAt: new Date().toISOString(), outcome: null, durationMs: null, model: null, cached: false });
    return { runId: id };
  }

  async appendEvent(e: RunEvent) {
    this.events.push(structuredClone(e));
  }

  async finishRun(runId: string, r: Parameters<Repo["finishRun"]>[1]) {
    const run = this.runs.get(runId);
    if (run) Object.assign(run, r);
  }
}
