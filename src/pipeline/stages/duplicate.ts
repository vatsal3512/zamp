import type { ExtractedInvoice, Finding, Policy, PriorInvoice, RuleHit, StageResult } from "@/domain/types";
import { toCents } from "@/domain/money";
import { normalizeInvoiceNumber, similarity, tokenJaccard } from "@/domain/text";

export interface DuplicateData { best: { invoiceId: string; invoiceNumber: string; score: number; recurringGuard: boolean } | null }

const DAY = 86_400_000;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * score = 1 if normalised invoice numbers are equal, else
 *   0.4·similarity(numbers) + 0.3·(amount within 1%) + 0.2·line overlap + 0.1·date proximity.
 * Recurring guard: both have a service period and they differ → not a duplicate.
 * Separate-order guard: both were matched to purchase orders and the POs differ → not a duplicate. A resend bills
 * the same order; double-billing one PO is caught by the PO-overrun check instead.
 * An identical invoice number (score 1) is never excused by either guard.
 */
export function duplicateCheck(x: ExtractedInvoice, vendorId: string, priors: PriorInvoice[], policy: Policy, poNumber: string | null = null): StageResult<DuplicateData> {
  const hits: RuleHit[] = [];
  const findings: Finding[] = [];
  const num = normalizeInvoiceNumber(x.invoiceNumber.value ?? "");
  const date = Date.parse(x.invoiceDate.value ?? "");
  const amount = x.total.value === null ? null : toCents(x.total.value);
  const descs = x.lines.map((l) => l.description ?? "").filter(Boolean);

  let best: DuplicateData["best"] = null;
  for (const p of priors) {
    if (p.vendorId !== vendorId) continue;
    const days = Math.abs(date - Date.parse(p.invoiceDate)) / DAY;
    if (!(days <= policy.dupWindowDays)) continue;
    let score: number;
    if (num && normalizeInvoiceNumber(p.invoiceNumber) === num) score = 1;
    else {
      const amountMatch = amount !== null && Math.abs(amount - p.totalCents) <= Math.abs(p.totalCents) * 0.01 ? 1 : 0;
      const overlap = descs.length ? descs.filter((d) => p.lineDescriptions.some((pd) => tokenJaccard(d, pd) >= 0.8)).length / descs.length : 0;
      score = 0.4 * similarity(num, normalizeInvoiceNumber(p.invoiceNumber)) + 0.3 * amountMatch + 0.2 * overlap + 0.1 * Math.max(0, 1 - days / policy.dupWindowDays);
    }
    let recurringGuard = false;
    if (score < 1 && x.servicePeriod.value && p.servicePeriod && x.servicePeriod.value !== p.servicePeriod) {
      recurringGuard = true;
      findings.push({ level: "info", text: `Resembles ${p.invoiceNumber} (score ${round3(score).toFixed(2)}) but bills a different service period (${x.servicePeriod.value} vs ${p.servicePeriod}) — not a duplicate` });
      score = 0;
    } else if (score < 1 && poNumber && p.poNumber && poNumber !== p.poNumber) {
      recurringGuard = true;
      findings.push({ level: "info", text: `Resembles ${p.invoiceNumber} (score ${round3(score).toFixed(2)}) but bills a different purchase order (${poNumber} vs ${p.poNumber}) — a separate order, not a resend` });
      score = 0;
    }
    score = round3(score);
    if (!best || score > best.score || (recurringGuard && best.score === 0)) best = { invoiceId: p.invoiceId, invoiceNumber: p.invoiceNumber, score, recurringGuard };
  }

  if (best && best.score >= policy.dupRejectScore) {
    hits.push({ rule: "R-DUP-01", outcome: "REJECT", facts: { original: best.invoiceNumber, score: best.score } });
    findings.push({ level: "error", text: `Probable duplicate of ${best.invoiceNumber} (score ${best.score.toFixed(2)})` });
  } else if (best && best.score >= policy.dupHoldScore) {
    hits.push({ rule: "R-DUP-02", outcome: "HOLD", facts: { original: best.invoiceNumber, score: best.score } });
    findings.push({ level: "warn", text: `Possible duplicate of ${best.invoiceNumber} (score ${best.score.toFixed(2)})` });
  } else if (!best?.recurringGuard) {
    findings.push({ level: "ok", text: best ? `No duplicate (closest ${best.invoiceNumber}, score ${best.score.toFixed(2)})` : "No prior invoices from this vendor in the last 90 days" });
  }
  return { hits, findings, data: { best } };
}
