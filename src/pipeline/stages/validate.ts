import type { Cents, ExtractedInvoice, Finding, LineType, NetLine, Policy, RuleHit, StageResult } from "@/domain/types";
import { formatPct, formatUsd, toCents } from "@/domain/money";
import { quoteFound, tokenJaccard } from "@/domain/text";

export interface ValidateData {
  quoteChecks: { field: string; found: boolean; score: number }[];
  arithmeticOk: boolean;
  arithmeticReason: string | null;
  netLines: NetLine[];
  taxCents: Cents;
  currency: string;
}

export interface ValidateCtx {
  pageTexts: string[];
  kind: "digital" | "scanned";
  company: { name: string; aliases: string[] };
  policy: Policy;
}

const NOT_PAYABLE = new Set(["statement", "purchase_order", "quote", "receipt", "other"]);
const FREIGHT = /freight|shipping|delivery|postage|handling/i;
const isIsoDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function validate(x: ExtractedInvoice, ctx: ValidateCtx): StageResult<ValidateData> {
  const hits: RuleHit[] = [];
  const findings: Finding[] = [];
  const currency = (x.currency.value ?? "USD").toUpperCase();
  const data: ValidateData = { quoteChecks: [], arithmeticOk: true, arithmeticReason: null, netLines: [], taxCents: 0, currency };
  const halt = (): StageResult<ValidateData> => ({ hits, findings, data, halt: true });

  // 1. Is this a payable invoice at all?
  if (NOT_PAYABLE.has(x.documentType)) {
    hits.push({ rule: "R-DOC-02", outcome: "REJECT", facts: { documentType: x.documentType.replace("_", " "), reason: x.documentTypeReason ?? "" } });
    findings.push({ level: "error", text: `Not a payable invoice — classified as ${x.documentType.replace("_", " ")}` });
    return halt();
  }
  if (x.documentType === "credit_note") {
    hits.push({ rule: "R-DOC-02", outcome: "HOLD", facts: { documentType: "credit note", reason: x.documentTypeReason ?? "" } });
    findings.push({ level: "warn", text: "Credit note — to be applied against the vendor balance, not paid" });
    return halt();
  }
  findings.push({ level: "ok", text: "Document is an invoice" });

  // 2. Bill-to entity
  if (x.billTo.value) {
    const best = Math.max(...[ctx.company.name, ...ctx.company.aliases].map((n) => tokenJaccard(x.billTo.value!, n)));
    if (best < 0.6) {
      hits.push({ rule: "R-DOC-03", outcome: "HOLD", facts: { billTo: x.billTo.value, company: ctx.company.name } });
      findings.push({ level: "warn", text: `Billed to "${x.billTo.value}", not ${ctx.company.name}` });
    } else findings.push({ level: "ok", text: `Bill-to matches ${ctx.company.name}` });
  }

  // 3. Currency
  if (!x.currency.value) findings.push({ level: "info", text: "Currency not stated — assumed USD" });
  else if (currency !== "USD") {
    hits.push({ rule: "R-CUR-01", outcome: "HOLD", facts: { currency } });
    findings.push({ level: "warn", text: `Invoice is in ${currency}; we only pay in USD` });
  }

  // 4. Required fields
  const missing = [
    !x.invoiceNumber.value && "invoice number",
    !isIsoDate(x.invoiceDate.value) && "invoice date",
    !x.vendorName.value && "vendor name",
    x.total.value === null && "total",
  ].filter(Boolean) as string[];
  if (missing.length) {
    hits.push({ rule: "R-EXT-01", outcome: "HOLD", facts: { missing: missing.join(", ") } });
    findings.push({ level: "error", text: `Missing: ${missing.join(", ")}` });
    return halt();
  }

  // 5. Resolve lines (tax lines count as tax)
  let lineTax = 0;
  const net: NetLine[] = [];
  for (const [i, l] of x.lines.entries()) {
    if (l.lineType === "tax") {
      lineTax += toCents(l.amount ?? 0);
      continue;
    }
    let amount = l.amount;
    if (amount === null && l.quantity !== null && l.unitPrice !== null) amount = l.quantity * l.unitPrice;
    if (amount === null) {
      hits.push({ rule: "R-EXT-01", outcome: "HOLD", facts: { missing: `amount for line ${i + 1}` } });
      findings.push({ level: "error", text: `Line ${i + 1} has no readable amount` });
      return halt();
    }
    const quantity = l.quantity ?? 1;
    const unit = l.unitPrice ?? (quantity ? amount / quantity : amount);
    const description = l.description ?? `Line ${i + 1}`;
    const lineType: LineType = l.lineType ?? (FREIGHT.test(description) ? "freight" : amount < 0 ? "discount" : "goods");
    net.push({ index: i, description, lineType, quantity, unitCents: toCents(unit), amountCents: toCents(amount) });
  }
  const printedSum = net.reduce((s, l) => s + l.amountCents, 0);

  // 6. Tax basis
  const taxCents = x.taxTotal.value !== null ? toCents(x.taxTotal.value) : lineTax;
  data.taxCents = taxCents;
  let taxOk = true;
  if (x.taxInclusive === true) {
    if (taxCents === 0) {
      hits.push({ rule: "R-TAX-01", outcome: "HOLD", facts: { reason: "Prices include tax but no tax amount is shown" } });
      findings.push({ level: "warn", text: "Prices include tax but no tax amount is shown" });
      taxOk = false;
    } else if (printedSum > 0) {
      const factor = (printedSum - taxCents) / printedSum;
      for (const l of net) {
        l.unitCents = Math.round(l.unitCents * factor);
        l.amountCents = Math.round(l.amountCents * factor);
      }
      findings.push({ level: "info", text: `Tax-inclusive prices converted to pre-tax (tax ${formatUsd(taxCents)})` });
    }
  }
  const netSum = net.reduce((s, l) => s + l.amountCents, 0);
  if (taxOk && currency === "USD" && netSum > 0 && taxCents !== 0) {
    const rate = taxCents / netSum;
    if (rate < 0 || rate > ctx.policy.maxTaxRate) {
      hits.push({ rule: "R-TAX-01", outcome: "HOLD", facts: { rate: formatPct(rate) } });
      findings.push({ level: "warn", text: `Implied tax rate ${formatPct(rate)} is outside 0–${formatPct(ctx.policy.maxTaxRate, 0)}` });
    } else findings.push({ level: "ok", text: `Tax ${formatUsd(taxCents)} (${formatPct(rate, 2)})` });
  }
  data.netLines = net;

  // 7. Evidence: quotes must appear on the page (digital PDFs only)
  if (ctx.kind === "digital") {
    const all = ctx.pageTexts.join("\n");
    const check = (field: string, quote: string | null, page: number | null) => {
      if (!quote) return;
      const text = page && ctx.pageTexts[page - 1] !== undefined ? ctx.pageTexts[page - 1] : all;
      const r = quoteFound(quote, text, ctx.policy.quoteMinSimilarity);
      data.quoteChecks.push({ field, found: r.found, score: r.score });
      if (!r.found) findings.push({ level: "warn", text: `Quote for ${field} ("${quote}") not found on page ${page ?? "?"}` });
    };
    const header = ["invoiceNumber", "invoiceDate", "vendorName", "poNumber", "subtotal", "taxTotal", "total", "bankAccount"] as const;
    for (const k of header) if (x[k].value !== null) check(k, x[k].quote, x[k].page);
    x.lines.forEach((l, i) => check(`line ${i + 1}`, l.quote, l.page));
    const ok = data.quoteChecks.filter((q) => q.found).length;
    if (data.quoteChecks.length) findings.push({ level: ok === data.quoteChecks.length ? "ok" : "warn", text: `${ok}/${data.quoteChecks.length} values verified on the page` });
  }

  // 8. Arithmetic (as printed)
  const tol = Math.max(1, net.length);
  const sub = x.subtotal.value !== null ? toCents(x.subtotal.value) : null;
  const total = toCents(x.total.value!);
  const fail = (reason: string) => {
    data.arithmeticOk = false;
    data.arithmeticReason = reason;
    findings.push({ level: "warn", text: reason });
  };
  if (x.taxInclusive === true) {
    if (Math.abs(printedSum - total) > tol) fail(`Line items sum to ${formatUsd(printedSum)} but the invoice states ${formatUsd(total)}`);
  } else if (sub !== null && Math.abs(printedSum - sub) > tol) {
    fail(`Line items sum to ${formatUsd(printedSum)} but the invoice states ${formatUsd(sub)}`);
  } else if (Math.abs((sub ?? printedSum) + taxCents - total) > tol) {
    fail(`Subtotal ${formatUsd(sub ?? printedSum)} plus tax ${formatUsd(taxCents)} is ${formatUsd((sub ?? printedSum) + taxCents)} but the invoice states ${formatUsd(total)}`);
  }
  if (data.arithmeticOk) findings.push({ level: "ok", text: `Totals reconcile (${formatUsd(total)})` });

  return { hits, findings, data };
}
