import type { Cents, Finding, GoodsReceipt, NetLine, Policy, PoLine, PurchaseOrder, RuleHit, StageResult } from "@/domain/types";
import { formatPct, formatSignedUsd, formatUsd } from "@/domain/money";
import { tokenJaccard } from "@/domain/text";

export interface LineMatch {
  invoiceLine: number; poLineNo: number | null; poUnitCents: Cents | null; invUnitCents: Cents; qty: number;
  priceVarPct: number | null; priceVarCents: Cents | null; receivedQty: number | null;
  status: "ok" | "price" | "qty" | "freight" | "discount" | "bundled" | "unmatched";
}
export interface MatchData { lines: LineMatch[]; invoiceSubtotalCents: Cents; cumulativeAfterCents: Cents; overrunCents: Cents; overrunPct: number }

export function match(lines: NetLine[], totalCents: Cents, po: PurchaseOrder, grns: GoodsReceipt[], policy: Policy): StageResult<MatchData> {
  const hits: RuleHit[] = [];
  const findings: Finding[] = [];
  const threeWay = po.matchType === "3-way";
  const noReceipt = threeWay && grns.length === 0;
  const received = (lineNo: number) => grns.reduce((s, g) => s + (g.lines.find((l) => l.lineNo === lineNo)?.quantityReceived ?? 0), 0);

  // 1. Map invoice lines to PO lines (each PO line at most once)
  const used = new Set<number>();
  const mapped = new Map<number, PoLine>();
  for (const l of lines) {
    let best: PoLine | null = null;
    let bestScore = 0.5 - 1e-9;
    for (const p of po.lines) {
      if (used.has(p.lineNo)) continue;
      const s = tokenJaccard(l.description, p.description);
      if (s > bestScore) [best, bestScore] = [p, s];
    }
    if (best) {
      used.add(best.lineNo);
      mapped.set(l.index, best);
    }
  }

  const out: LineMatch[] = [];
  let totalPriceVar = 0;
  const unmatched: NetLine[] = [];

  // 2. Price (and receipts) on mapped lines
  for (const l of lines) {
    const p = mapped.get(l.index);
    if (!p) {
      unmatched.push(l);
      continue;
    }
    const varCents = (l.unitCents - p.unitPriceCents) * l.quantity;
    const varPct = (l.unitCents - p.unitPriceCents) / p.unitPriceCents;
    const rec = threeWay ? received(p.lineNo) : null;
    const m: LineMatch = { invoiceLine: l.index, poLineNo: p.lineNo, poUnitCents: p.unitPriceCents, invUnitCents: l.unitCents, qty: l.quantity,
      priceVarPct: varPct, priceVarCents: varCents, receivedQty: rec, status: "ok" };
    totalPriceVar += Math.max(0, varCents);
    if (varPct > policy.priceTolPct || varCents > policy.priceTolAbsCents) {
      m.status = "price";
      hits.push({ rule: "R-TOL-01", outcome: "HOLD", facts: { scope: "line", line: l.description, poUnit: p.unitPriceCents, invUnit: l.unitCents, pct: varPct, cents: varCents, tolPct: policy.priceTolPct, tolAbs: policy.priceTolAbsCents } });
      findings.push({ level: "error", text: `${l.description}: ${formatUsd(l.unitCents)} vs PO ${formatUsd(p.unitPriceCents)} (${formatSignedUsd(varCents)} · +${formatPct(varPct)})` });
    } else if (varCents > 0) {
      hits.push({ rule: "R-TOL-02", outcome: "NOTE", facts: { line: l.description, pct: varPct, cents: varCents } });
      findings.push({ level: "info", text: `${l.description}: ${formatSignedUsd(varCents)} within tolerance` });
    } else findings.push({ level: "ok", text: `${l.description}: price matches PO` });

    if (threeWay && !noReceipt && rec !== null && l.quantity > rec) {
      m.status = "qty";
      hits.push({ rule: "R-GRN-01", outcome: "HOLD", facts: { line: l.description, billed: l.quantity, received: rec } });
      findings.push({ level: "error", text: `${l.description}: billed ${l.quantity}, received ${rec}` });
    }
    out.push(m);
  }
  if (totalPriceVar > policy.priceTolAbsCents && !hits.some((h) => h.rule === "R-TOL-01")) {
    hits.push({ rule: "R-TOL-01", outcome: "HOLD", facts: { scope: "invoice", cents: totalPriceVar, tolAbs: policy.priceTolAbsCents } });
    findings.push({ level: "error", text: `Price differences add up to ${formatSignedUsd(totalPriceVar)} across the invoice` });
  }

  // 3. Unmatched lines: freight → discount → bundled → uncontracted
  const rest: NetLine[] = [];
  const blank = (l: NetLine, status: LineMatch["status"]): LineMatch =>
    ({ invoiceLine: l.index, poLineNo: null, poUnitCents: null, invUnitCents: l.unitCents, qty: l.quantity, priceVarPct: null, priceVarCents: null, receivedQty: null, status });
  for (const l of unmatched) {
    if (l.lineType === "freight") {
      const ok = l.amountCents <= policy.freightCapCents;
      hits.push({ rule: "R-FRT-01", outcome: ok ? "NOTE" : "HOLD", facts: { amount: l.amountCents, cap: policy.freightCapCents } });
      findings.push({ level: ok ? "info" : "error", text: `Freight ${formatUsd(l.amountCents)} ${ok ? "within" : "above"} the ${formatUsd(policy.freightCapCents)} allowance` });
      out.push(blank(l, "freight"));
    } else if (l.lineType === "discount" || l.amountCents < 0) {
      findings.push({ level: "info", text: `Discount ${formatUsd(l.amountCents)} — favourable` });
      out.push(blank(l, "discount"));
    } else rest.push(l);
  }
  if (rest.length) {
    const open = po.lines.filter((p) => !used.has(p.lineNo));
    const sumU = rest.reduce((s, l) => s + l.amountCents, 0);
    const sumP = open.reduce((s, p) => s + p.quantity * p.unitPriceCents, 0);
    const diff = Math.abs(sumU - sumP);
    const bundled = open.length > 0 && diff <= sumP * policy.priceTolPct && diff <= policy.priceTolAbsCents;
    if (bundled) {
      hits.push({ rule: "R-BUN-01", outcome: "NOTE", facts: { invoiceLines: rest.length, poLines: open.map((p) => p.description).join(", ") } });
      findings.push({ level: "info", text: `${rest.length} bundled line(s) match ${open.length} PO lines at the total level (${formatUsd(sumU)})` });
      rest.forEach((l) => out.push(blank(l, "bundled")));
      if (threeWay && !noReceipt) {
        for (const p of open) {
          const rec = received(p.lineNo);
          if (rec < p.quantity) hits.push({ rule: "R-GRN-01", outcome: "HOLD", facts: { line: p.description, billed: p.quantity, received: rec } });
        }
      }
    } else {
      for (const l of rest) {
        hits.push({ rule: "R-LIN-01", outcome: "HOLD", facts: { description: l.description, amount: l.amountCents } });
        findings.push({ level: "error", text: `"${l.description}" (${formatUsd(l.amountCents)}) is not on ${po.poNumber}` });
        out.push(blank(l, "unmatched"));
      }
    }
  }

  // 4. No receipt at all on a 3-way PO
  if (noReceipt) {
    hits.push({ rule: "R-GRN-02", outcome: "HOLD", facts: { poNumber: po.poNumber } });
    findings.push({ level: "error", text: `No goods receipt recorded against ${po.poNumber}` });
  } else if (threeWay) findings.push({ level: "ok", text: `Goods receipt on file (${grns.map((g) => g.grnNumber).join(", ")})` });

  // 5. Cumulative billing against the PO (pre-tax, freight excluded)
  const invoiceSubtotalCents = lines.filter((l) => l.lineType !== "freight").reduce((s, l) => s + l.amountCents, 0);
  const cumulativeAfterCents = po.billedToDateCents + invoiceSubtotalCents;
  const limit = Math.round(po.totalCents * (1 + policy.poOverrunPct));
  const overrunCents = Math.max(0, cumulativeAfterCents - po.totalCents);
  const overrunPct = overrunCents / po.totalCents;
  if (cumulativeAfterCents > limit) {
    const facts: RuleHit["facts"] = { poNumber: po.poNumber, poTotal: po.totalCents, cumulativeAfter: cumulativeAfterCents, overrunCents, overrunPct };
    if (po.lines.length === 1) {
      const unit = po.lines[0].unitPriceCents;
      facts.overUnits = Math.round(overrunCents / unit);
      facts.remainingUnits = Math.round((po.totalCents - po.billedToDateCents) / unit);
    }
    hits.push({ rule: "R-PO-03", outcome: "HOLD", facts });
    findings.push({ level: "error", text: `Billing on ${po.poNumber} would reach ${formatUsd(cumulativeAfterCents)} of ${formatUsd(po.totalCents)} (${formatSignedUsd(overrunCents)} · +${formatPct(overrunPct)})` });
  } else findings.push({ level: "ok", text: `${po.poNumber}: ${formatUsd(cumulativeAfterCents)} of ${formatUsd(po.totalCents)} billed after this invoice` });

  // 6. Approval threshold
  if (totalCents > policy.approvalThresholdCents) {
    hits.push({ rule: "R-APR-01", outcome: "ROUTE_FOR_APPROVAL", facts: { total: totalCents, threshold: policy.approvalThresholdCents } });
    findings.push({ level: "info", text: `${formatUsd(totalCents)} is above the ${formatUsd(policy.approvalThresholdCents)} sign-off limit` });
  }

  return { hits, findings, data: { lines: out, invoiceSubtotalCents, cumulativeAfterCents, overrunCents, overrunPct } };
}
