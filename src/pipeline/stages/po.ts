import type { ExtractedInvoice, Finding, NetLine, Policy, PurchaseOrder, RuleHit, StageResult, Vendor } from "@/domain/types";
import { tokenJaccard } from "@/domain/text";

export interface PoData { po: PurchaseOrder | null; inferred: boolean; candidates: { poNumber: string; score: number }[] }

const round2 = (n: number) => Math.round(n * 100) / 100;
const normPo = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, "");

/** Deterministic PO scoring: 70% line overlap + 30% "fits in the remaining PO balance". */
function score(lines: NetLine[], po: PurchaseOrder, policy: Policy): number {
  const matchable = lines.filter((l) => l.lineType !== "freight" && l.lineType !== "discount");
  if (!matchable.length) return 0;
  const hit = matchable.filter((l) => po.lines.some((p) => tokenJaccard(l.description, p.description) >= 0.5)).length;
  const subtotal = matchable.reduce((s, l) => s + l.amountCents, 0);
  const amountFit = subtotal <= (po.totalCents - po.billedToDateCents) * (1 + policy.priceTolPct) ? 1 : 0;
  return round2(0.7 * (hit / matchable.length) + 0.3 * amountFit);
}

export function poLookup(
  x: ExtractedInvoice, lines: NetLine[], vendor: Vendor,
  getPo: (n: string) => PurchaseOrder | null, openPos: PurchaseOrder[], policy: Policy,
  vendorNameOf: (id: string) => string = (id) => id,
): StageResult<PoData> {
  const hits: RuleHit[] = [];
  const findings: Finding[] = [];
  const hold = (hit: RuleHit, text: string, candidates: PoData["candidates"] = []): StageResult<PoData> => {
    hits.push(hit);
    findings.push({ level: "error", text });
    return { hits, findings, data: { po: null, inferred: false, candidates }, halt: true };
  };

  const ref = x.poNumber.value ? normPo(x.poNumber.value) : null;
  const explicit = ref ? getPo(ref) : null;
  if (explicit) {
    if (explicit.vendorId !== vendor.id) {
      const owner = vendorNameOf(explicit.vendorId);
      return hold({ rule: "R-PO-01", outcome: "HOLD", facts: { reason: `${explicit.poNumber} belongs to ${owner}`, candidates: explicit.poNumber } },
        `${explicit.poNumber} belongs to ${owner}, not ${vendor.legalName}`);
    }
    if (explicit.status !== "open") {
      return hold({ rule: "R-PO-04", outcome: "HOLD", facts: { poNumber: explicit.poNumber, status: explicit.status } }, `${explicit.poNumber} is ${explicit.status}`);
    }
    findings.push({ level: "ok", text: `${explicit.poNumber} found (explicit reference)` });
    return { hits, findings, data: { po: explicit, inferred: false, candidates: [{ poNumber: explicit.poNumber, score: 1 }] } };
  }
  if (ref) findings.push({ level: "warn", text: `Referenced ${ref} not found — searching open POs for ${vendor.legalName}` });
  else findings.push({ level: "info", text: `No PO reference printed — searching open POs for ${vendor.legalName}` });

  const candidates = openPos.map((p) => ({ poNumber: p.poNumber, score: score(lines, p, policy) })).sort((a, b) => b.score - a.score);
  const [top, second] = candidates;
  if (top && top.score >= 0.75 && top.score - (second?.score ?? 0) >= 0.15) {
    const po = openPos.find((p) => p.poNumber === top.poNumber)!;
    hits.push({ rule: "R-PO-02", outcome: "NOTE", facts: { poNumber: po.poNumber, score: top.score } });
    findings.push({ level: "ok", text: `Inferred ${po.poNumber} (score ${top.score.toFixed(2)}${second ? `; next ${second.poNumber} ${second.score.toFixed(2)}` : ""})` });
    return { hits, findings, data: { po, inferred: true, candidates } };
  }
  const plausible = candidates.filter((c) => c.score >= 0.75).map((c) => c.poNumber);
  return hold(
    { rule: "R-PO-01", outcome: "HOLD", facts: { candidates: plausible.length ? plausible.join(", ") : "none" } },
    plausible.length ? `Can't tell which PO this is for: ${plausible.join(" or ")}` : "No matching purchase order found",
    candidates,
  );
}
