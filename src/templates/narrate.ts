/**
 * "What happened" — the decision told as a short story for someone who doesn't know the rule codes.
 * Built only from the decision's rule facts (like every other explanation here), so it can't contradict the decision.
 */
import type { Decision, RuleHit } from "@/domain/types";
import { formatUsd } from "@/domain/money";
import { explain } from "./explain";

export interface NarrateContext {
  vendorName: string | null; invoiceNumber: string | null; totalCents: number | null; currency: string | null;
  poNumber: string | null; received: boolean;
}

const FRAUD = new Set(["R-VEN-02", "R-VEN-03"]);
const MATCH_PROBLEMS = /^R-(TOL-01|PO-0[134]|LIN-01|GRN-0[12]|EXT-02|TAX-01)$/;
const OWNER_TEAM: Record<string, string> = { AP: "the AP team", Procurement: "Procurement", Treasury: "Treasury", Approver: "an approver", Receiving: "Receiving" };
const DOC_KIND: Record<string, string> = { statement: "a statement of account", purchase_order: "a purchase order", quote: "a quote", receipt: "a receipt", other: "a letter or other document" };

/** "UMBRELLA PRINT CO." → "Umbrella Print Co." (only when the reader returned it all in capitals). */
export function tidyName(s: string | null): string | null {
  if (!s || s !== s.toUpperCase() || !/[A-Z]{2}/.test(s)) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Llc|Inc|Ltd|Gmbh|Pvt)\b/g, (m) => (m === "Gmbh" ? "GmbH" : m.toUpperCase()));
}

function amount(c: NarrateContext, abs = false): string | null {
  if (c.totalCents == null) return null;
  const cents = abs ? Math.abs(c.totalCents) : c.totalCents;
  const cur = (c.currency ?? "USD").toUpperCase();
  return cur === "USD" ? formatUsd(cents) : `${cur} ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

/** "Invoice INV-10601 from Globex Corporation for $9,870.00" */
function subject(c: NarrateContext, noun = "invoice"): string {
  const vendor = tidyName(c.vendorName);
  const amt = amount(c, noun === "credit note");
  const head = c.invoiceNumber ? `${noun[0].toUpperCase()}${noun.slice(1)} ${c.invoiceNumber}` : `An ${noun}`.replace("An c", "A c");
  return `${head}${vendor ? ` from ${vendor}` : ""}${amt ? ` for ${amt}` : ""}`;
}

const reason = (h: RuleHit) => explain(h.rule, h.facts).reason;
const joinReasons = (hs: RuleHit[]) => hs.map(reason).join(" ");
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`);
const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/\.\.(?!\.)/g, ".").trim();

export function narrate(d: Decision, c: NarrateContext): string {
  return tidy(story(d, c));
}

function story(d: Decision, c: NarrateContext): string {
  const notes = d.hits.filter((h) => h.outcome === "NOTE");
  const problems = d.hits.filter((h) => h.outcome !== "NOTE");
  const primary = d.primary;
  const owner = d.owner ? OWNER_TEAM[d.owner] ?? d.owner : "a person";
  const inferred = d.hits.some((h) => h.rule === "R-PO-02");
  const poPhrase = c.poNumber ? `purchase order ${c.poNumber}${inferred ? " (found from the line items, since none was printed)" : ""}` : null;

  if (d.outcome === "APPROVE") {
    const checks = [poPhrase ? `matches ${poPhrase}` : "matches its purchase order", c.received ? "the goods are recorded as received" : null, "the prices agree"];
    const noteText = notes.filter((n) => n.rule !== "R-PO-02").map(reason);
    return `${subject(c)} ${list(checks.filter((x): x is string => !!x))}. It isn't a duplicate and the vendor's details match our records, so it was approved and posted to the ledger without anyone touching it.${noteText.length ? ` Noted along the way: ${noteText.join(" ")}` : ""}`;
  }

  if (d.outcome === "ROUTE_FOR_APPROVAL") {
    const apr = d.hits.find((h) => h.rule === "R-APR-01");
    const limit = apr && typeof apr.facts.threshold === "number" ? formatUsd(apr.facts.threshold) : "sign-off";
    return `${subject(c)} passed every check, but it's above the ${limit} limit that needs a person's sign-off, so it's waiting for ${owner}. Nothing is paid until they approve.`;
  }

  if (primary?.rule === "R-DOC-02") {
    const kind = String(primary.facts.documentType ?? "other");
    if (kind === "credit note") {
      return `${subject(c, "credit note")} isn't a bill to pay — it's money ${tidyName(c.vendorName) ?? "the vendor"} owes us, to apply against what we owe them. It's waiting on ${owner} to apply it.`;
    }
    const why = primary.facts.reason ? ` The reader's reason: ${String(primary.facts.reason).replace(/\.$/, "")}.` : "";
    const from = tidyName(c.vendorName);
    return `This document${from ? ` from ${from}` : ""} is ${DOC_KIND[kind] ?? `a ${kind}`}, not an invoice.${why} There's nothing to pay, so it was set aside without touching the ledger.`;
  }

  if (primary?.rule === "R-DUP-01" || primary?.rule === "R-DOC-01") {
    return `${subject(c)} was rejected as a resend of an invoice we've already accepted. ${reason(primary)} Rejecting it means the same bill can't be paid twice; nothing was posted.`;
  }

  if (d.outcome === "REJECT") {
    return `${subject(c)} was rejected. ${joinReasons(problems)} Nothing was paid or posted.`;
  }

  // HOLD
  const fraud = problems.filter((h) => FRAUD.has(h.rule));
  if (fraud.length) {
    const cleanMatch = c.poNumber && !problems.some((h) => MATCH_PROBLEMS.test(h.rule));
    const surface = cleanMatch ? `looks right on the surface — the amounts match ${poPhrase} — but it shows` : "shows";
    const signs = fraud.length === 1 ? "a classic sign of invoice fraud" : `${fraud.length} classic signs of invoice fraud`;
    return `${subject(c)} ${surface} ${signs}. ${joinReasons(fraud)} Payment is blocked, and ${owner} has been asked to confirm with ${tidyName(c.vendorName) ?? "the vendor"} using the contact already on file, never one from this invoice or email.`;
  }

  const others = problems.filter((h) => h !== primary);
  const head = `${subject(c)} can't be paid automatically yet. ${primary ? reason(primary) : ""}${others.length ? ` Also: ${joinReasons(others)}` : ""}`;
  const waiting = d.question ? ` It's waiting on ${owner} for the one question below.` : ` It's waiting on ${owner}.`;
  const blocked = d.paymentBlocked ? (/blocked/i.test(head) ? "" : " Payment is blocked until then.") : " Nothing is paid until it's answered.";
  return `${head}${waiting}${blocked}${d.email ? " A note to the vendor is drafted and ready to send." : ""}`;
}
