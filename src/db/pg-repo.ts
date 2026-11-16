import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as t from "./schema";
import type { Cents, ExtractedInvoice, Outcome, Policy, PriorInvoice, PurchaseOrder, RunEvent, Vendor } from "@/domain/types";
import type { AppRepo, AuditRow, InboxRow, OverrideAction, Repo, RunDetail, RunSummary } from "@/pipeline/ports";
import { toCents } from "@/domain/money";

export type Db = PgDatabase<PgQueryResultHKT, typeof t>;

const toPo = (r: typeof t.purchaseOrders.$inferSelect): PurchaseOrder => ({ ...r });
const toPrior = (r: typeof t.priorInvoices.$inferSelect): PriorInvoice => ({ ...r, outcome: r.outcome as Outcome });

export class PgRepo implements AppRepo {
  constructor(private db: Db) {}

  // ---- policy ----
  async getPolicy(): Promise<Policy> {
    const [row] = await this.db.select().from(t.policies).orderBy(desc(t.policies.version)).limit(1);
    return { ...row.body, version: row.version };
  }
  async savePolicy(p: Omit<Policy, "version">, actor: string): Promise<Policy> {
    const before = await this.getPolicy();
    const version = before.version + 1;
    const body = { ...p } as Omit<Policy, "version"> & { version?: number };
    delete body.version;
    await this.db.insert(t.policies).values({ version, body });
    const after = { ...body, version };
    await this.audit(actor, "policy.update", `policy v${version}`, before, after);
    return after;
  }

  // ---- master data ----
  async getVendors(): Promise<Vendor[]> { return this.db.select().from(t.vendors); }
  async getPurchaseOrder(poNumber: string) {
    const [r] = await this.db.select().from(t.purchaseOrders).where(eq(t.purchaseOrders.poNumber, poNumber));
    return r ? toPo(r) : null;
  }
  async getOpenPurchaseOrders(vendorId: string) {
    return (await this.db.select().from(t.purchaseOrders).where(and(eq(t.purchaseOrders.vendorId, vendorId), eq(t.purchaseOrders.status, "open")))).map(toPo);
  }
  async getGoodsReceipts(poNumber: string) { return this.db.select().from(t.goodsReceipts).where(eq(t.goodsReceipts.poNumber, poNumber)); }
  async getPriorInvoices(vendorId: string) {
    return (await this.db.select().from(t.priorInvoices).where(eq(t.priorInvoices.vendorId, vendorId))).map(toPrior);
  }
  async findAcceptedInvoiceByHash(sha256: string) {
    const rows = await this.db.select().from(t.priorInvoices)
      .where(and(eq(t.priorInvoices.sha256, sha256), inArray(t.priorInvoices.outcome, ["APPROVE", "ROUTE_FOR_APPROVAL"]))).limit(1);
    return rows[0] ? toPrior(rows[0]) : null;
  }
  async listMasterData() {
    const [vendors, purchaseOrders, goodsReceipts] = await Promise.all([
      this.getVendors(),
      this.db.select().from(t.purchaseOrders).orderBy(asc(t.purchaseOrders.poNumber)).then((r) => r.map(toPo)),
      this.db.select().from(t.goodsReceipts).orderBy(asc(t.goodsReceipts.grnNumber)),
    ]);
    return { vendors, purchaseOrders, goodsReceipts };
  }

  // ---- invoices & ledger ----
  async saveInvoiceResult(r: Parameters<Repo["saveInvoiceResult"]>[0]) {
    const id = `inv_${randomUUID().slice(0, 12)}`;
    const x = r.extracted;
    const totalCents = x?.total.value != null ? toCents(x.total.value) : null;
    const lineDescriptions = x?.lines.map((l) => l.description ?? "").filter(Boolean) ?? [];
    await this.db.insert(t.invoices).values({
      id, runId: r.runId, documentId: r.documentId, vendorId: r.vendorId, poNumber: r.poNumber,
      invoiceNumber: x?.invoiceNumber.value ?? null, invoiceDate: x?.invoiceDate.value ?? null, extracted: x,
      totalCents, servicePeriod: x?.servicePeriod.value ?? null, lineDescriptions, outcome: r.decision.outcome, sha256: r.sha256,
    });
    await this.db.update(t.runs).set({ decision: r.decision }).where(eq(t.runs.id, r.runId));
    const accepted = r.decision.outcome === "APPROVE" || r.decision.outcome === "ROUTE_FOR_APPROVAL";
    if (accepted && x && r.vendorId) {
      await this.db.insert(t.priorInvoices).values({
        invoiceId: id, vendorId: r.vendorId, invoiceNumber: x.invoiceNumber.value ?? "", invoiceDate: x.invoiceDate.value ?? "",
        totalCents: totalCents ?? 0, servicePeriod: x.servicePeriod.value, lineDescriptions, outcome: r.decision.outcome, sha256: r.sha256,
      });
    }
    return { invoiceId: id };
  }

  async postToLedger(poNumber: string, invoiceId: string, amountCents: Cents) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select({ v: t.purchaseOrders.billedToDateCents }).from(t.purchaseOrders).where(eq(t.purchaseOrders.poNumber, poNumber));
      if (!before) throw new Error(`Unknown PO ${poNumber}`);
      const [after] = await tx.update(t.purchaseOrders)
        .set({ billedToDateCents: before.v + amountCents })
        .where(eq(t.purchaseOrders.poNumber, poNumber))
        .returning({ v: t.purchaseOrders.billedToDateCents });
      await tx.update(t.invoices).set({ posted: true, postedAmountCents: amountCents }).where(eq(t.invoices.id, invoiceId));
      await tx.insert(t.auditLog).values({ actor: "agent", action: "ledger.post", entity: poNumber, before: { billedToDateCents: before.v }, after: { billedToDateCents: after.v, invoiceId } });
      return { beforeCents: before.v, afterCents: after.v };
    });
  }

  async readBackLedger(poNumber: string, invoiceId: string) {
    const [po] = await this.db.select({ v: t.purchaseOrders.billedToDateCents }).from(t.purchaseOrders).where(eq(t.purchaseOrders.poNumber, poNumber));
    const [inv] = await this.db.select({ posted: t.invoices.posted }).from(t.invoices).where(eq(t.invoices.id, invoiceId));
    return { billedToDateCents: po?.v ?? 0, invoicePosted: inv?.posted ?? false };
  }

  // ---- runs & events ----
  async createRun(r: Parameters<Repo["createRun"]>[0]) {
    const id = `run_${randomUUID().slice(0, 12)}`;
    await this.db.insert(t.runs).values({ id, documentId: r.documentId, source: r.source, rerunOf: r.rerunOf ?? null, policyVersion: r.policyVersion });
    return { runId: id };
  }
  async appendEvent(e: RunEvent) {
    await this.db.insert(t.runEvents).values({ runId: e.runId, seq: e.seq, stage: e.stage, type: e.type, at: e.at, durationMs: e.durationMs ?? null, data: e.data ?? null });
  }
  async finishRun(runId: string, r: Parameters<Repo["finishRun"]>[1]) {
    await this.db.update(t.runs).set({ outcome: r.outcome, durationMs: r.durationMs, model: r.model, cached: r.cached }).where(eq(t.runs.id, runId));
  }

  private async summaries(runRows: (typeof t.runs.$inferSelect)[]): Promise<RunSummary[]> {
    if (!runRows.length) return [];
    const ids = runRows.map((r) => r.id);
    const [invs, vendors] = await Promise.all([this.db.select().from(t.invoices).where(inArray(t.invoices.runId, ids)), this.getVendors()]);
    return runRows.map((r) => {
      const inv = invs.find((i) => i.runId === r.id);
      const d = r.decision;
      return {
        id: r.id, documentId: r.documentId, source: r.source, rerunOf: r.rerunOf, outcome: r.outcome as RunSummary["outcome"],
        startedAt: r.startedAt, durationMs: r.durationMs, model: r.model, cached: r.cached, policyVersion: r.policyVersion,
        invoiceId: inv?.id ?? null, invoiceNumber: inv?.invoiceNumber ?? null,
        vendorName: vendors.find((v) => v.id === inv?.vendorId)?.legalName ?? inv?.extracted?.vendorName.value ?? null,
        totalCents: inv?.totalCents ?? null, poNumber: inv?.poNumber ?? null,
        primaryRule: d?.primary?.rule ?? null, summary: d?.summary ?? null,
        override: r.overrideAction ? { action: r.overrideAction as OverrideAction, reason: r.overrideReason ?? "", at: r.overrideAt ?? "" } : null,
        posted: inv?.posted ?? false,
      };
    });
  }

  async listRuns(filter?: { needsAttention?: boolean }) {
    const rows = await this.db.select().from(t.runs).orderBy(desc(t.runs.startedAt));
    const all = await this.summaries(rows);
    return filter?.needsAttention ? all.filter(needsAttention) : all;
  }

  async getRun(id: string): Promise<RunDetail | null> {
    const [row] = await this.db.select().from(t.runs).where(eq(t.runs.id, id));
    if (!row) return null;
    const [summary] = await this.summaries([row]);
    const events = (await this.db.select().from(t.runEvents).where(eq(t.runEvents.runId, id)).orderBy(asc(t.runEvents.seq)))
      .map((e) => ({ runId: e.runId, seq: e.seq, stage: e.stage, type: e.type, at: e.at, durationMs: e.durationMs ?? undefined, data: e.data ?? undefined }));
    const [inv] = await this.db.select({ extracted: t.invoices.extracted }).from(t.invoices).where(eq(t.invoices.runId, id));
    return { ...summary, events, decision: row.decision, extracted: inv?.extracted ?? null };
  }

  async recordOverride(runId: string, action: OverrideAction, reason: string, actor: string) {
    const [before] = await this.db.select({ outcome: t.runs.outcome, action: t.runs.overrideAction }).from(t.runs).where(eq(t.runs.id, runId));
    await this.db.update(t.runs).set({ overrideAction: action, overrideReason: reason, overrideAt: new Date().toISOString() }).where(eq(t.runs.id, runId));
    await this.audit(actor, `run.${action}`, runId, before ?? null, { action, reason });
  }

  // ---- inbox & documents ----
  async listInbox(): Promise<InboxRow[]> {
    const rows = await this.db.select({ m: t.inboxMessages, filename: t.documents.filename }).from(t.inboxMessages)
      .innerJoin(t.documents, eq(t.documents.id, t.inboxMessages.documentId)).orderBy(asc(t.inboxMessages.sortOrder));
    return rows.map(({ m, filename }) => ({ id: m.id, scenarioTag: m.scenarioTag, from: m.from, subject: m.subject, body: m.body, receivedAt: m.receivedAt, documentId: m.documentId, filename }));
  }
  async getDocument(id: string) {
    const [d] = await this.db.select().from(t.documents).where(eq(t.documents.id, id));
    return d ? { id: d.id, filename: d.filename, bytes: d.bytes } : null;
  }
  async saveDocument(bytes: Uint8Array, filename: string) {
    const id = `doc_${randomUUID().slice(0, 12)}`;
    await this.db.insert(t.documents).values({ id, filename, bytes });
    return { documentId: id };
  }
  async putUploadChunk(uploadId: string, idx: number, bytes: Uint8Array) {
    await this.db.insert(t.uploadChunks).values({ uploadId, idx, bytes }).onConflictDoUpdate({ target: [t.uploadChunks.uploadId, t.uploadChunks.idx], set: { bytes } });
  }
  async takeUploadChunks(uploadId: string) {
    const rows = await this.db.select().from(t.uploadChunks).where(eq(t.uploadChunks.uploadId, uploadId)).orderBy(asc(t.uploadChunks.idx));
    await this.db.delete(t.uploadChunks).where(eq(t.uploadChunks.uploadId, uploadId));
    return rows.map((r) => r.bytes);
  }

  // ---- cache & audit ----
  async getCache(key: string) {
    const [r] = await this.db.select().from(t.extractionCache).where(eq(t.extractionCache.key, key));
    return r ? { ...r.body, _model: r.model } : null;
  }
  async setCache(key: string, model: string, v: ExtractedInvoice) {
    await this.db.insert(t.extractionCache).values({ key, model, body: v }).onConflictDoUpdate({ target: t.extractionCache.key, set: { model, body: v } });
  }
  async listAudit(): Promise<AuditRow[]> {
    return (await this.db.select().from(t.auditLog).orderBy(desc(t.auditLog.id))).map((a) => ({ ...a }));
  }
  private async audit(actor: string, action: string, entity: string, before: unknown, after: unknown) {
    await this.db.insert(t.auditLog).values({ actor, action, entity, before: before as object, after: after as object });
  }
}

/** HOLD not yet resolved by a person, or ROUTE not yet signed off. */
export function needsAttention(r: RunSummary): boolean {
  if (r.outcome === "HOLD") return !r.override || r.override.action === "query_sent";
  if (r.outcome === "ROUTE_FOR_APPROVAL") return r.override?.action !== "sign_off" && r.override?.action !== "reject";
  return false;
}
