import { readFileSync } from "node:fs";
import path from "node:path";
import type { Cents, Decision, ExtractedInvoice, Outcome, Policy, PriorInvoice, RunEvent } from "@/domain/types";
import type { AppRepo, AuditRow, InboxRow, OverrideAction, RunDetail, RunSummary, StoredDocument } from "@/pipeline/ports";
import { toCents } from "@/domain/money";
import { needsAttention } from "@/domain/attention";
import { SEED, type SeedData } from "../../fixtures/seed-data";
import { SCENARIOS } from "../../fixtures/scenarios";

export interface StoredInvoice {
  id: string; runId: string; documentId: string; sha256: string; vendorId: string | null; poNumber: string | null;
  extracted: ExtractedInvoice | null; decision: Decision; posted: boolean; postedAmountCents: Cents;
}
export interface StoredRun {
  id: string; documentId: string; source: "inbox" | "upload" | "rerun"; rerunOf?: string; policyVersion: number;
  startedAt: string; outcome: Outcome | "FAILED" | null; durationMs: number | null; model: string | null; cached: boolean;
  decision?: Decision; override?: { action: OverrideAction; reason: string; at: string };
}

/** In-memory AppRepo for tests, eval and REPO=memory dev mode. Scenario PDFs are read lazily from fixtures/pdfs. */
export class MemoryRepo implements AppRepo {
  protected state!: SeedData;
  readonly runs = new Map<string, StoredRun>();
  readonly invoices = new Map<string, StoredInvoice>();
  readonly events: RunEvent[] = [];
  private documents = new Map<string, StoredDocument>();
  private cache = new Map<string, ExtractedInvoice & { _model: string }>();
  private chunks = new Map<string, Map<number, Uint8Array>>();
  private audit: AuditRow[] = [];
  private n = 0;

  constructor(private seed: SeedData = SEED, private root = process.cwd()) {
    this.reset();
  }

  reset(): void {
    this.state = structuredClone(this.seed);
    this.runs.clear();
    this.invoices.clear();
    this.events.length = 0;
    this.audit = [];
    for (const k of [...this.documents.keys()]) if (!k.startsWith("doc-")) this.documents.delete(k);
  }

  setPolicy(p: Partial<Policy>): void {
    this.state.policy = { ...this.state.policy, ...p, version: this.state.policy.version + 1 };
  }

  async savePolicy(p: Omit<Policy, "version">, actor: string): Promise<Policy> {
    const before = structuredClone(this.state.policy);
    this.state.policy = { ...p, version: before.version + 1 };
    this.audit.unshift({ id: this.audit.length + 1, at: new Date().toISOString(), actor, action: "policy.update", entity: `policy v${this.state.policy.version}`, before, after: this.state.policy });
    return structuredClone(this.state.policy);
  }

  private summary(r: StoredRun): RunSummary {
    const inv = [...this.invoices.values()].find((i) => i.runId === r.id);
    const vendor = this.state.vendors.find((v) => v.id === inv?.vendorId);
    return {
      id: r.id, documentId: r.documentId, source: r.source, rerunOf: r.rerunOf ?? null, outcome: r.outcome, startedAt: r.startedAt,
      durationMs: r.durationMs, model: r.model, cached: r.cached, policyVersion: r.policyVersion,
      invoiceId: inv?.id ?? null, invoiceNumber: inv?.extracted?.invoiceNumber.value ?? null,
      vendorName: vendor?.legalName ?? inv?.extracted?.vendorName.value ?? null,
      totalCents: inv?.extracted?.total.value != null ? toCents(inv.extracted.total.value) : null, poNumber: inv?.poNumber ?? null,
      primaryRule: r.decision?.primary?.rule ?? null, summary: r.decision?.summary ?? null, override: r.override ?? null, posted: inv?.posted ?? false,
    };
  }
  async listRuns(filter?: { needsAttention?: boolean }) {
    const all = [...this.runs.values()].reverse().map((r) => this.summary(r));
    return filter?.needsAttention ? all.filter(needsAttention) : all;
  }
  async getRun(id: string): Promise<RunDetail | null> {
    const r = this.runs.get(id);
    if (!r) return null;
    const inv = [...this.invoices.values()].find((i) => i.runId === id);
    return { ...this.summary(r), events: this.eventsFor(id), decision: r.decision ?? null, extracted: inv?.extracted ?? null };
  }
  async recordOverride(runId: string, action: OverrideAction, reason: string, actor: string) {
    const r = this.runs.get(runId);
    if (!r) return;
    r.override = { action, reason, at: new Date().toISOString() };
    this.audit.unshift({ id: this.audit.length + 1, at: r.override.at, actor, action: `run.${action}`, entity: runId, before: { outcome: r.outcome }, after: { action, reason } });
  }
  async listAudit() { return structuredClone(this.audit); }
  async listMasterData() {
    return structuredClone({ vendors: this.state.vendors, purchaseOrders: this.state.purchaseOrders, goodsReceipts: this.state.goodsReceipts });
  }

  async listInbox(): Promise<InboxRow[]> {
    return SCENARIOS.map((s) => ({ id: `msg-${s.id}`, scenarioTag: s.tag, from: s.envelope.from, subject: s.envelope.subject, body: s.envelope.body,
      receivedAt: s.envelope.receivedAt, documentId: `doc-${s.id}`, filename: s.file }));
  }
  async getDocument(id: string) {
    const known = this.documents.get(id);
    if (known) return known;
    const s = SCENARIOS.find((x) => `doc-${x.id}` === id);
    if (!s) return null;
    const doc = { id, filename: s.file, bytes: new Uint8Array(readFileSync(path.join(/*turbopackIgnore: true*/ this.root, "fixtures/pdfs", s.file))) };
    this.documents.set(id, doc);
    return doc;
  }
  async saveDocument(bytes: Uint8Array, filename: string) {
    const id = this.id("upload");
    this.documents.set(id, { id, filename, bytes });
    return { documentId: id };
  }
  async putUploadChunk(uploadId: string, idx: number, bytes: Uint8Array) {
    if (!this.chunks.has(uploadId)) this.chunks.set(uploadId, new Map());
    this.chunks.get(uploadId)!.set(idx, bytes);
  }
  async takeUploadChunks(uploadId: string) {
    const m = this.chunks.get(uploadId) ?? new Map<number, Uint8Array>();
    this.chunks.delete(uploadId);
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
  }
  async getCache(key: string) { return structuredClone(this.cache.get(key) ?? null); }
  async setCache(key: string, model: string, v: ExtractedInvoice) { this.cache.set(key, { ...structuredClone(v), _model: model }); }

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

  async saveInvoiceResult(r: Parameters<AppRepo["saveInvoiceResult"]>[0]) {
    const id = this.id("inv");
    this.invoices.set(id, { id, ...structuredClone(r), posted: false, postedAmountCents: 0 });
    const run = this.runs.get(r.runId);
    if (run) run.decision = structuredClone(r.decision);
    const x = r.extracted;
    const accepted = r.decision.outcome === "APPROVE" || r.decision.outcome === "ROUTE_FOR_APPROVAL";
    if (accepted && x && r.vendorId) {
      const prior: PriorInvoice = {
        invoiceId: id, vendorId: r.vendorId, invoiceNumber: x.invoiceNumber.value ?? "", invoiceDate: x.invoiceDate.value ?? "",
        totalCents: x.total.value === null ? 0 : toCents(x.total.value), servicePeriod: x.servicePeriod.value,
        lineDescriptions: x.lines.map((l) => l.description ?? "").filter(Boolean), outcome: r.decision.outcome, sha256: r.sha256,
        poNumber: r.poNumber ?? null,
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

  async createRun(r: Parameters<AppRepo["createRun"]>[0]) {
    const id = this.id("run");
    this.runs.set(id, { id, ...r, startedAt: new Date().toISOString(), outcome: null, durationMs: null, model: null, cached: false });
    return { runId: id };
  }

  async appendEvent(e: RunEvent) {
    this.events.push(structuredClone(e));
  }

  async finishRun(runId: string, r: Parameters<AppRepo["finishRun"]>[1]) {
    const run = this.runs.get(runId);
    if (run) Object.assign(run, r);
  }
}
