/**
 * Plain-English text for every rule. The decision's summary, reasons, question and vendor email are rendered
 * from rule facts here — never by an AI call — so the explanation can't contradict the decision.
 */
import type { Decision, DraftEmail, RuleHit, RuleId, Vendor } from "@/domain/types";
import { formatPct, formatSignedUsd, formatUsd } from "@/domain/money";

type Facts = RuleHit["facts"];
export interface Explanation { reason: string; question: string | null; short: string }

const usd = (v: unknown) => (typeof v === "number" ? formatUsd(v) : "—");
const pct = (v: unknown, d = 1) => (typeof v === "number" ? formatPct(v, d) : "—");
const s = (v: unknown, fallback = "—") => (v === undefined || v === null || v === "" ? fallback : String(v));
const score = (v: unknown) => (typeof v === "number" ? v.toFixed(2) : "—");

const T: Record<RuleId, (f: Facts) => Explanation> = {
  "R-DOC-01": () => ({ short: "already processed", reason: "This exact file was already processed and accepted.", question: null }),
  "R-DOC-02": (f) =>
    f.documentType === "credit note"
      ? { short: "credit note", reason: "Credit note — apply it against the vendor's balance instead of paying.", question: "Apply this credit to the vendor's open balance?" }
      : { short: `not an invoice (${s(f.documentType, "other")})`, reason: `This isn't a payable invoice — it looks like a ${s(f.documentType, "document")}${f.reason ? `: ${f.reason}` : ""}.`, question: null },
  "R-DOC-03": (f) => ({ short: "billed to another company", reason: `Billed to ${s(f.billTo)}, not ${s(f.company, "us")}.`, question: `Should this go to ${s(f.billTo)}'s AP team instead?` }),
  "R-DOC-04": (f) => ({ short: "unreadable file", reason: `The file couldn't be read as a PDF${f.error ? ` (${f.error})` : ""}.`, question: "Ask the vendor to resend the invoice?" }),
  "R-EXT-01": (f) => ({ short: "missing details", reason: `Missing: ${s(f.missing, "required details")}.`, question: "Ask the vendor for a complete invoice?" }),
  "R-EXT-02": (f) => ({ short: "totals don't add up", reason: `${s(f.reason, "The invoice totals don't reconcile")}.`, question: `${s(f.reason, "The invoice totals don't reconcile")}. Confirm the correct amount with the vendor?` }),
  "R-TAX-01": (f) => ({ short: "tax doesn't reconcile", reason: f.reason ? `${f.reason}.` : `Tax of ${s(f.rate)} looks wrong for this invoice.`, question: "Confirm the tax treatment with the vendor?" }),
  "R-CUR-01": (f) => ({ short: `invoice in ${s(f.currency)}`, reason: `Invoice is in ${s(f.currency)}; we pay in USD only.`, question: "Route to Treasury for a foreign-currency payment?" }),
  "R-VEN-01": (f) => ({ short: "unknown vendor", reason: `${s(f.vendorName, "This vendor")} isn't in our vendor master.`, question: "Start vendor onboarding before paying?" }),
  "R-VEN-02": (f) => ({ short: "bank details changed", reason: `Bank details don't match our records (invoice ••${s(f.invoiceLast4)}, on file ••${s(f.masterLast4)}).`, question: "Verify by calling the contact already on file — not the number on this invoice — before paying." }),
  "R-VEN-03": (f) => ({ short: "unexpected sender", reason: `Sent from ${s(f.senderDomain)}, but this vendor's domain on file is ${s(f.expectedDomain)}.`, question: "Verify by calling the contact already on file — not the number on this invoice — before paying." }),
  "R-VEN-04": (f) => ({ short: `vendor ${s(f.status, "inactive")}`, reason: `This vendor is ${s(f.status, "inactive")} in our records — payment blocked until it's reinstated.`, question: "Should Procurement reinstate this vendor?" }),
  "R-PO-01": (f) =>
    f.reason
      ? { short: "wrong PO", reason: `${f.reason}.`, question: "Which of this vendor's POs does this belong to?" }
      : f.candidates && f.candidates !== "none"
        ? { short: "ambiguous PO", reason: `Could match ${s(f.candidates)} — the agent won't guess.`, question: `Is this for ${String(f.candidates).replace(/, /g, " or ")}?` }
        : { short: "no matching PO", reason: "No matching purchase order found.", question: "Which PO does this belong to?" },
  "R-PO-02": (f) => ({ short: "PO inferred", reason: `No PO printed — inferred ${s(f.poNumber)} from the line items (score ${score(f.score)}).`, question: null }),
  "R-PO-03": (f) => {
    const hours = f.overUnits !== undefined;
    return {
      short: "over the PO total",
      reason: `Billing on ${s(f.poNumber)} would exceed the PO by ${usd(f.overrunCents)} (${pct(f.overrunPct)}).`,
      question: hours
        ? `This invoice would bring total billing on ${s(f.poNumber)} to ${usd(f.cumulativeAfter)} — ${s(f.overUnits)} hours / ${usd(f.overrunCents)} (${pct(f.overrunPct)}) over the PO. Approve a PO amendment, or ask the vendor to re-bill within the remaining ${s(f.remainingUnits)} hours?`
        : `This invoice would bring total billing on ${s(f.poNumber)} to ${usd(f.cumulativeAfter)} — ${usd(f.overrunCents)} (${pct(f.overrunPct)}) over the PO. Approve a PO amendment, or ask the vendor to re-bill?`,
    };
  },
  "R-PO-04": (f) => ({ short: `PO ${s(f.status, "closed")}`, reason: `${s(f.poNumber)} is ${s(f.status, "closed")} — it can't be billed against.`, question: "Reopen the PO or raise a new one?" }),
  "R-TOL-01": (f) =>
    f.scope === "invoice"
      ? { short: "price over tolerance", reason: `Price differences add up to ${formatSignedUsd(Number(f.cents ?? 0))}, above the ${usd(f.tolAbs)} tolerance.`, question: "Accept the new prices and update the PO, or ask the vendor to re-bill at PO prices?" }
      : { short: "price over tolerance", reason: `Unit price ${usd(f.invUnit)} vs PO ${usd(f.poUnit)} (+${pct(f.pct)}, ${usd(f.cents)}) exceeds the ${pct(f.tolPct, 0)} / ${usd(f.tolAbs)} price tolerance.`, question: "Accept the new price and update the PO, or ask the vendor to re-bill at the PO price?" },
  "R-TOL-02": (f) => ({ short: "price within tolerance", reason: `${s(f.line, "A line")} is ${usd(f.cents)} (+${pct(f.pct)}) over the PO price — within tolerance.`, question: null }),
  "R-LIN-01": (f) => ({ short: "item not on the PO", reason: `"${s(f.description, "A line")}"${typeof f.amount === "number" ? ` (${usd(f.amount)})` : ""} isn't on the PO.`, question: "Was this ordered? Raise a PO change, or ask the vendor to remove it?" }),
  "R-BUN-01": (f) => ({ short: "bundled billing", reason: `${s(f.invoiceLines, "1")} bundled invoice line(s) match the PO's ${s(f.poLines, "lines")} at the total level.`, question: null }),
  "R-FRT-01": (f) =>
    typeof f.amount === "number" && typeof f.cap === "number" && f.amount > f.cap
      ? { short: "freight over allowance", reason: `Freight ${usd(f.amount)} is above the ${usd(f.cap)} freight allowance.`, question: "Accept the freight charge, or ask the vendor to waive it?" }
      : { short: "freight accepted", reason: `Freight ${usd(f.amount)} accepted (within the ${usd(f.cap)} freight allowance).`, question: null },
  "R-GRN-01": (f) => ({ short: "billed more than received", reason: `${s(f.line, "A line")}: billed ${s(f.billed)}, received ${s(f.received)}.`, question: "Has the rest been delivered?" }),
  "R-GRN-02": (f) => ({ short: "no goods receipt", reason: `No goods receipt is recorded against ${s(f.poNumber)}.`, question: `Has this delivery arrived? No goods receipt is recorded against ${s(f.poNumber)} yet.` }),
  "R-DUP-01": (f) => ({ short: "duplicate", reason: `Probable duplicate of ${s(f.original)} (match score ${score(f.score)}).`, question: null }),
  "R-DUP-02": (f) => ({ short: "possible duplicate", reason: `Possible duplicate of ${s(f.original)} (match score ${score(f.score)}).`, question: `Is this a new charge, or a resend of ${s(f.original)}?` }),
  "R-APR-01": (f) => ({ short: "above sign-off limit", reason: `${usd(f.total)} is above the ${usd(f.threshold)} sign-off limit.`, question: "Approve this payment?" }),
};

export function explain(rule: RuleId, facts: Facts): Explanation {
  return T[rule](facts);
}

/** What we ask the vendor to do, for rules the vendor can fix. Fraud rules never email the sender. */
const VENDOR_ASK: Partial<Record<RuleId, (f: Facts) => string>> = {
  "R-EXT-01": () => "send a corrected invoice that includes the missing details",
  "R-EXT-02": () => "confirm the correct amount and send a corrected invoice",
  "R-DOC-04": () => "resend the invoice as a readable PDF",
  "R-LIN-01": () => "confirm whether these items were ordered, or re-issue the invoice without them",
  "R-PO-03": () => "re-issue the invoice within the remaining PO balance, or confirm the additional work was approved by our procurement team",
  "R-DUP-01": (f) => `confirm whether this is a resend of ${s(f.original)}`,
};

export function draftEmail(decision: Decision, vendor: Vendor | null, invoiceNumber: string | null): DraftEmail | null {
  const p = decision.primary;
  if (!p || !vendor || !VENDOR_ASK[p.rule]) return null;
  const ref = invoiceNumber ? `invoice ${invoiceNumber}` : "your recent invoice";
  const reasons = decision.hits.filter((h) => h.outcome !== "NOTE").map((h) => `- ${explain(h.rule, h.facts).reason}`).join("\n");
  return {
    to: vendor.contactOnFile,
    subject: `${invoiceNumber ? `Invoice ${invoiceNumber}` : "Your invoice"} — action needed`,
    body: `Hello ${vendor.legalName} team,\n\nWe're unable to process ${ref} yet:\n${reasons}\n\nCould you please ${VENDOR_ASK[p.rule]!(p.facts)}?\n\nThank you,\nNorthwind Labs — Accounts Payable`,
  };
}
