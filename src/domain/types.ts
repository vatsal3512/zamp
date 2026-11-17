import type { Attempt } from "@/ai/key-pool";

export type Cents = number;
export type Outcome = "APPROVE" | "ROUTE_FOR_APPROVAL" | "HOLD" | "REJECT";
export type Owner = "AP" | "Procurement" | "Receiving" | "Treasury" | "Approver";

export const RULE_IDS = [
  "R-DOC-01", "R-DOC-02", "R-DOC-03", "R-DOC-04", "R-EXT-01", "R-EXT-02", "R-TAX-01", "R-CUR-01",
  "R-VEN-01", "R-VEN-02", "R-VEN-03", "R-VEN-04", "R-PO-01", "R-PO-02", "R-PO-03", "R-PO-04",
  "R-TOL-01", "R-TOL-02", "R-LIN-01", "R-BUN-01", "R-FRT-01", "R-GRN-01", "R-GRN-02",
  "R-DUP-01", "R-DUP-02", "R-APR-01",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export const STAGE_IDS = ["intake", "inspect", "extract", "validate", "vendor", "po", "match", "duplicate", "decide", "act"] as const;
export type StageId = (typeof STAGE_IDS)[number];

export type Box = [number, number, number, number]; // [ymin, xmin, ymax, xmax], 0–1000
export interface Field<T> { value: T; quote: string | null; page: number | null; confidence: number; box?: Box }

export type LineType = "goods" | "service" | "freight" | "tax" | "discount" | "other";
export interface ExtractedLine {
  description: string | null; lineType: LineType | null;
  quantity: number | null; unitPrice: number | null; amount: number | null; // nullable; may be negative
  quote: string | null; page: number | null; confidence: number; box?: Box;
}

export const DOCUMENT_TYPES = ["invoice", "credit_note", "statement", "purchase_order", "quote", "receipt", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface ExtractedInvoice {
  documentType: DocumentType; documentTypeReason: string | null;
  invoiceNumber: Field<string | null>; invoiceDate: Field<string | null>; dueDate: Field<string | null>;
  vendorName: Field<string | null>; vendorTaxId: Field<string | null>; billTo: Field<string | null>;
  poNumber: Field<string | null>; currency: Field<string | null>; servicePeriod: Field<string | null>; // "YYYY-MM"
  taxInclusive: boolean | null; lines: ExtractedLine[];
  subtotal: Field<number | null>; taxTotal: Field<number | null>; total: Field<number | null>;
  bankAccount: Field<string | null>;
}

export interface Vendor {
  id: string; legalName: string; aliases: string[]; taxId: string;
  status: "approved" | "blocked" | "suspended" | "onboarding";
  bankAccount: string; emailDomain: string; contactOnFile: string;
}
export interface PoLine { lineNo: number; description: string; quantity: number; unitPriceCents: Cents }
export interface PurchaseOrder {
  poNumber: string; vendorId: string; matchType: "2-way" | "3-way"; currency: string;
  lines: PoLine[]; totalCents: Cents; billedToDateCents: Cents; status: "open" | "closed" | "cancelled";
}
/** Line after Validate resolved nulls and tax basis — what Match consumes. Pre-tax; lump-sum → quantity 1. */
export interface NetLine { index: number; description: string; lineType: LineType; quantity: number; unitCents: Cents; amountCents: Cents }
export interface GoodsReceipt { grnNumber: string; poNumber: string; receivedAt: string; lines: { lineNo: number; quantityReceived: number }[] }
export interface PriorInvoice {
  invoiceId: string; vendorId: string; invoiceNumber: string; invoiceDate: string; totalCents: Cents;
  servicePeriod: string | null; lineDescriptions: string[]; outcome: Outcome; sha256: string;
  poNumber?: string | null; // the PO it was matched to; a different PO means a separate order
}
export interface Policy {
  version: number; priceTolPct: number; priceTolAbsCents: Cents; poOverrunPct: number; freightCapCents: Cents;
  approvalThresholdCents: Cents; dupRejectScore: number; dupHoldScore: number; dupWindowDays: number;
  quoteMinSimilarity: number; maxTaxRate: number; owners: Record<RuleId, Owner>;
}
export interface Finding { level: "ok" | "info" | "warn" | "error"; text: string }
export interface RuleHit { rule: RuleId; outcome: Outcome | "NOTE"; facts: Record<string, string | number> }
export interface StageResult<T> { hits: RuleHit[]; findings: Finding[]; data: T; halt?: boolean }
export interface DraftEmail { to: string; subject: string; body: string }
export interface Decision {
  outcome: Outcome; hits: RuleHit[]; primary: RuleHit | null; owner: Owner | null;
  summary: string; reasons: string[]; question: string | null; email: DraftEmail | null;
  paymentBlocked: boolean; fraudSignals: number;
}
export type RunEventType = "started" | "finding" | "retrying" | "completed" | "failed" | "decision" | "done";
export interface RunEvent { runId: string; seq: number; stage: StageId; type: RunEventType; at: string; durationMs?: number; data?: unknown }
export interface InboxEnvelope { from: string; subject: string; body: string; receivedAt: string }

export type { Attempt };
