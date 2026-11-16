import type { Attempt } from "@/ai/key-pool";
import type {
  Cents, Decision, ExtractedInvoice, GoodsReceipt, Outcome, Policy, PriorInvoice, PurchaseOrder, RunEvent, Vendor,
} from "@/domain/types";

export interface ExtractResult { invoice: ExtractedInvoice; model: string; cached: boolean; attempts: Attempt[] }

export interface ExtractOptions { reextract?: { reason: string }; fresh?: boolean; onRetry?: (a: Attempt) => void }

export interface Extractor {
  extract(pdf: Uint8Array, sha256: string, opts?: ExtractOptions): Promise<ExtractResult>;
}

/** Receives every run event as it happens (already numbered and timestamped). Must not be relied on to throw. */
export type Emit = (e: RunEvent) => void;

export interface Repo {
  getPolicy(): Promise<Policy>;
  getVendors(): Promise<Vendor[]>;
  getPurchaseOrder(poNumber: string): Promise<PurchaseOrder | null>;
  getOpenPurchaseOrders(vendorId: string): Promise<PurchaseOrder[]>;
  getGoodsReceipts(poNumber: string): Promise<GoodsReceipt[]>;
  getPriorInvoices(vendorId: string): Promise<PriorInvoice[]>;
  /** Invoices with outcome APPROVE | ROUTE_FOR_APPROVAL only. */
  findAcceptedInvoiceByHash(sha256: string): Promise<PriorInvoice | null>;
  saveInvoiceResult(r: {
    runId: string; documentId: string; sha256: string; vendorId: string | null; poNumber: string | null;
    extracted: ExtractedInvoice | null; decision: Decision;
  }): Promise<{ invoiceId: string }>;
  postToLedger(poNumber: string, invoiceId: string, amountCents: Cents): Promise<{ beforeCents: Cents; afterCents: Cents }>;
  readBackLedger(poNumber: string, invoiceId: string): Promise<{ billedToDateCents: Cents; invoicePosted: boolean }>;
  createRun(r: { documentId: string; source: "inbox" | "upload" | "rerun"; rerunOf?: string; policyVersion: number }): Promise<{ runId: string }>;
  appendEvent(e: RunEvent): Promise<void>;
  finishRun(runId: string, r: { outcome: Outcome | "FAILED"; durationMs: number; model: string | null; cached: boolean }): Promise<void>;
}

// ---- App-level persistence (dashboard, workspace, AOP, uploads) — implemented by PgRepo and MemoryRepo ----
export type OverrideAction = "approve" | "sign_off" | "reject" | "query_sent";

export interface RunSummary {
  id: string; documentId: string; source: "inbox" | "upload" | "rerun"; rerunOf: string | null;
  outcome: Outcome | "FAILED" | null; startedAt: string; durationMs: number | null; model: string | null; cached: boolean;
  policyVersion: number; invoiceId: string | null; invoiceNumber: string | null; vendorName: string | null;
  totalCents: Cents | null; poNumber: string | null; primaryRule: string | null; summary: string | null;
  override: { action: OverrideAction; reason: string; at: string } | null; posted: boolean;
}
export interface RunDetail extends RunSummary { events: RunEvent[]; decision: Decision | null; extracted: ExtractedInvoice | null }
export interface InboxRow { id: string; scenarioTag: string; from: string; subject: string; body: string; receivedAt: string; documentId: string; filename: string }
export interface StoredDocument { id: string; filename: string; bytes: Uint8Array }
export interface AuditRow { id: number; at: string; actor: string; action: string; entity: string; before: unknown; after: unknown }

export interface AppRepo extends Repo {
  savePolicy(p: Omit<Policy, "version">, actor: string): Promise<Policy>;
  listRuns(filter?: { needsAttention?: boolean }): Promise<RunSummary[]>;
  getRun(id: string): Promise<RunDetail | null>;
  listInbox(): Promise<InboxRow[]>;
  getDocument(id: string): Promise<StoredDocument | null>;
  saveDocument(bytes: Uint8Array, filename: string): Promise<{ documentId: string }>;
  recordOverride(runId: string, action: OverrideAction, reason: string, actor: string): Promise<void>;
  listAudit(): Promise<AuditRow[]>;
  listMasterData(): Promise<{ vendors: Vendor[]; purchaseOrders: PurchaseOrder[]; goodsReceipts: GoodsReceipt[] }>;
  getCache(key: string): Promise<(ExtractedInvoice & { _model: string }) | null>;
  setCache(key: string, model: string, v: ExtractedInvoice): Promise<void>;
  putUploadChunk(uploadId: string, idx: number, bytes: Uint8Array): Promise<void>;
  takeUploadChunks(uploadId: string): Promise<Uint8Array[]>;
}
