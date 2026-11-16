/** Builds the ExtractedInvoice a perfect reader would return for a fixture document (test + eval support). */
import type { DocumentType, ExtractedInvoice, Field } from "@/domain/types";
import { INVOICE_DOCS, type InvoiceDoc } from "./invoice-docs";

const f = <T>(value: T, quote: string | null = value === null ? null : String(value)): Field<T> =>
  ({ value, quote, page: value === null ? null : 1, confidence: value === null ? 0.1 : 0.97 });

const printedDate = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

const usd = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function docToExtraction(d: InvoiceDoc): ExtractedInvoice {
  const documentType: DocumentType = d.layout === "statement" ? "statement" : d.layout === "credit" ? "credit_note" : "invoice";
  const taxSum = d.taxes.reduce((s, t) => s + t.amount, 0);
  const inclTax = d.taxInclusive ? Number((d.note ?? "").match(/\$([\d,.]+)/)?.[1].replace(/,/g, "") ?? NaN) : null;
  const taxTotal = d.taxInclusive ? inclTax : d.taxes.length ? Math.round(taxSum * 100) / 100 : null;
  const bank = d.bank ? (d.currency === "INR" ? d.bank.account : `${d.bank.routing}-${d.bank.account}`) : null;
  return {
    documentType,
    documentTypeReason: documentType === "invoice" ? "Titled invoice with amounts due" : `Titled ${d.title.toLowerCase()}`,
    invoiceNumber: f(d.invoiceNumber),
    invoiceDate: f(d.invoiceDate, printedDate(d.invoiceDate)),
    dueDate: f(d.dueDate, printedDate(d.dueDate)),
    vendorName: f(d.vendor.name),
    vendorTaxId: f(d.vendor.taxId ? d.vendor.taxId.replace(/^GSTIN\s*/, "") : null),
    billTo: f(d.billTo.name),
    poNumber: f(d.poNumber),
    currency: f(d.currency),
    servicePeriod: f(d.servicePeriod),
    taxInclusive: d.taxInclusive,
    lines: d.lines.map((l) => ({
      description: l.description, lineType: l.lineType, quantity: l.qty, unitPrice: l.unit, amount: l.amount,
      quote: l.description, page: 1, confidence: 0.96,
    })),
    subtotal: f(d.subtotal, d.subtotal === null ? null : usd(d.subtotal)),
    taxTotal: f(taxTotal, taxTotal === null ? null : usd(taxTotal)),
    total: f(d.total, usd(d.total)),
    bankAccount: f(bank, d.bank ? `Account: ${d.bank.account}` : null),
  };
}

/** What a reader returns for the Zamp candidate guide: not an invoice, nothing to extract. */
export const GUIDE_EXTRACTION: ExtractedInvoice = {
  documentType: "other", documentTypeReason: "Hiring case-study guide, not a bill",
  invoiceNumber: f(null), invoiceDate: f(null), dueDate: f(null), vendorName: f(null), vendorTaxId: f(null),
  billTo: f(null), poNumber: f(null), currency: f(null), servicePeriod: f(null), taxInclusive: null, lines: [],
  subtotal: f(null), taxTotal: f(null), total: f(null), bankAccount: f(null),
};

export function extractionFor(scenarioId: string): ExtractedInvoice {
  if (scenarioId === "guide") return structuredClone(GUIDE_EXTRACTION);
  const d = INVOICE_DOCS.find((x) => x.scenarioId === scenarioId);
  if (!d) throw new Error(`No fixture document for ${scenarioId}`);
  return docToExtraction(d);
}
