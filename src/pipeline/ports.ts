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
