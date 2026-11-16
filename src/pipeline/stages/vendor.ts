import type { ExtractedInvoice, Finding, InboxEnvelope, RuleHit, StageResult, Vendor } from "@/domain/types";
import { tokenJaccard } from "@/domain/text";

export interface VendorData { vendor: Vendor | null; matchedBy: "taxId" | "name" | null }

const digits = (s: string) => s.replace(/\D/g, "");

export function vendorCheck(x: ExtractedInvoice, vendors: Vendor[], envelope: InboxEnvelope | null): StageResult<VendorData> {
  const hits: RuleHit[] = [];
  const findings: Finding[] = [];

  let vendor: Vendor | null = null;
  let matchedBy: VendorData["matchedBy"] = null;
  const taxId = x.vendorTaxId.value ? digits(x.vendorTaxId.value) : "";
  if (taxId) vendor = vendors.find((v) => digits(v.taxId) === taxId) ?? null;
  if (vendor) matchedBy = "taxId";
  else if (x.vendorName.value) {
    let best = 0;
    for (const v of vendors) {
      const s = Math.max(...[v.legalName, ...v.aliases].map((n) => tokenJaccard(x.vendorName.value!, n)));
      if (s > best) [best, vendor] = [s, v];
    }
    if (best >= 0.6) matchedBy = "name";
    else vendor = null;
  }

  if (!vendor) {
    hits.push({ rule: "R-VEN-01", outcome: "HOLD", facts: { vendorName: x.vendorName.value ?? "unknown" } });
    findings.push({ level: "error", text: `"${x.vendorName.value ?? "Unknown vendor"}" is not in the vendor master` });
    return { hits, findings, data: { vendor: null, matchedBy: null }, halt: true };
  }
  findings.push({ level: "ok", text: `Matched ${vendor.legalName} by ${matchedBy === "taxId" ? "tax ID" : "name"}` });

  if (vendor.status !== "approved") {
    hits.push({ rule: "R-VEN-04", outcome: "HOLD", facts: { status: vendor.status, vendor: vendor.legalName } });
    findings.push({ level: "error", text: `${vendor.legalName} is ${vendor.status} in the vendor master` });
    return { hits, findings, data: { vendor, matchedBy }, halt: true };
  }

  // Bank details vs master
  if (!x.bankAccount.value) findings.push({ level: "info", text: "No bank details printed on the invoice" });
  else if (digits(x.bankAccount.value) !== digits(vendor.bankAccount)) {
    hits.push({ rule: "R-VEN-02", outcome: "HOLD", facts: { invoiceLast4: digits(x.bankAccount.value).slice(-4), masterLast4: digits(vendor.bankAccount).slice(-4) } });
    findings.push({ level: "error", text: `Bank account ••${digits(x.bankAccount.value).slice(-4)} differs from master ••${digits(vendor.bankAccount).slice(-4)}` });
  } else findings.push({ level: "ok", text: `Bank details match master (••${digits(vendor.bankAccount).slice(-4)})` });

  // Sender domain (inbox only)
  if (!envelope) findings.push({ level: "info", text: "Sender check n/a (uploaded document)" });
  else {
    const senderDomain = (envelope.from.split("@")[1] ?? "").toLowerCase();
    const expected = vendor.emailDomain.toLowerCase();
    if (senderDomain === expected || senderDomain.endsWith(`.${expected}`)) findings.push({ level: "ok", text: `Sent from ${senderDomain}` });
    else {
      hits.push({ rule: "R-VEN-03", outcome: "HOLD", facts: { senderDomain, expectedDomain: expected } });
      findings.push({ level: "error", text: `Sent from ${senderDomain}, expected ${expected}` });
    }
  }
  return { hits, findings, data: { vendor, matchedBy } };
}
