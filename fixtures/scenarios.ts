import type { Cents, DocumentType, InboxEnvelope, Outcome, RuleId } from "@/domain/types";

export interface Scenario {
  id: string; tag: string; title: string; file: string; kind: "digital" | "scanned";
  envelope: InboxEnvelope; expected: { outcome: Outcome; rules: RuleId[] }; launcher: boolean;
  truth: { documentType: DocumentType; invoiceNumber: string | null; totalCents: Cents | null; poNumber: string | null; vendorName: string | null; lineCount: number };
}

const env = (from: string, subject: string, body: string, receivedAt: string): InboxEnvelope => ({ from, subject, body, receivedAt });
const inv = (invoiceNumber: string | null, totalCents: number | null, poNumber: string | null, vendorName: string | null, lineCount: number, documentType: DocumentType = "invoice") =>
  ({ documentType, invoiceNumber, totalCents, poNumber, vendorName, lineCount });

export const SCENARIOS: Scenario[] = [
  { id: "happy", tag: "Happy", title: "Clean digital invoice", file: "acme-AC-5531.pdf", kind: "digital", launcher: true,
    envelope: env("billing@acmeoffice.com", "Invoice AC-5531 for PO-2031", "Hi team, please find attached invoice AC-5531 for PO-2031. Thanks, Acme Billing", "2026-11-10T09:12:00Z"),
    expected: { outcome: "APPROVE", rules: [] }, truth: inv("AC-5531", 125_559, "PO-2031", "Acme Office Supplies, LLC", 3) },
  { id: "ec1", tag: "EC-1", title: "Split billing overruns the PO", file: "initech-INI-1101.pdf", kind: "digital", launcher: true,
    envelope: env("ar@initech.io", "INI-1101 — November support hours", "Attached is our invoice for 140 support hours in October. Regards, Initech AR", "2026-11-11T14:03:00Z"),
    expected: { outcome: "HOLD", rules: ["R-PO-03"] }, truth: inv("INI-1101", 1_750_000, "PO-2041", "Initech Managed Services", 1) },
  { id: "ec2", tag: "EC-2", title: "Scanned invoice, no PO number", file: "stark-SIP-7781-scan.pdf", kind: "scanned", launcher: true,
    envelope: env("invoices@starkparts.com", "Invoice SIP-7781", "Scanned copy of our invoice attached.", "2026-11-11T16:40:00Z"),
    expected: { outcome: "APPROVE", rules: ["R-PO-02"] }, truth: inv("SIP-7781", 80_148, null, "Stark Industrial Parts", 3) },
  { id: "ec3a", tag: "EC-3a", title: "Disguised duplicate", file: "globex-INV10422-R.pdf", kind: "digital", launcher: true,
    envelope: env("billing@globex.com", "Updated Invoice INV10422-R", "Re-sending the October invoice with an updated date. Please process.", "2026-11-12T10:20:00Z"),
    expected: { outcome: "REJECT", rules: ["R-DUP-01"] }, truth: inv("INV10422-R", 240_000, "PO-2063", "Globex Corporation", 1) },
  { id: "ec3b", tag: "EC-3b", title: "Legitimate monthly repeat", file: "globex-INV-10587.pdf", kind: "digital", launcher: true,
    envelope: env("billing@globex.com", "Invoice INV-10587 — November subscription", "Your November platform subscription invoice is attached.", "2026-11-05T08:00:00Z"),
    expected: { outcome: "APPROVE", rules: [] }, truth: inv("INV-10587", 240_000, "PO-2063", "Globex Corporation", 1) },
  { id: "ec4", tag: "EC-4", title: "Bank details changed", file: "globex-INV-10601.pdf", kind: "digital", launcher: true,
    envelope: env("billing@globex-billing.co", "URGENT: Invoice INV-10601 — updated remittance details", "Please note our bank details have changed. Kindly pay INV-10601 to the new account before Friday.", "2026-11-13T17:55:00Z"),
    expected: { outcome: "HOLD", rules: ["R-VEN-02", "R-VEN-03"] }, truth: inv("INV-10601", 987_000, "PO-2064", "Globex Corporation", 1) },
  { id: "ec5", tag: "EC-5", title: "Broken arithmetic", file: "soylent-SC-2219.pdf", kind: "digital", launcher: true,
    envelope: env("billing@soylentcatering.com", "Invoice SC-2219 — all-hands lunch", "Thanks for having us! Invoice attached.", "2026-11-12T12:30:00Z"),
    expected: { outcome: "HOLD", rules: ["R-EXT-02"] }, truth: inv("SC-2219", 743_000, "PO-2090", "Soylent Catering", 3) },
  { id: "pv", tag: "PV", title: "Supplier price increase (policy flip)", file: "umbrella-UP-4410.pdf", kind: "digital", launcher: true,
    envelope: env("accounts@umbrellaprint.com", "Invoice UP-4410", "Please note our updated toner pricing effective this month.", "2026-11-12T15:10:00Z"),
    expected: { outcome: "HOLD", rules: ["R-TOL-01"] }, truth: inv("UP-4410", 112_797, "PO-2052", "Umbrella Print Co.", 1) },

  { id: "stmt", tag: "Statement", title: "Statement of account", file: "acme-statement-oct.pdf", kind: "digital", launcher: false,
    envelope: env("billing@acmeoffice.com", "October statement of account", "Your monthly statement is attached for your records.", "2026-11-01T07:00:00Z"),
    expected: { outcome: "REJECT", rules: ["R-DOC-02"] }, truth: inv(null, null, null, "Acme Office Supplies, LLC", 0, "statement") },
  { id: "credit", tag: "Credit note", title: "Credit note", file: "acme-credit-CN-112.pdf", kind: "digital", launcher: false,
    envelope: env("billing@acmeoffice.com", "Credit note CN-112", "Credit for the returned desk organizers.", "2026-11-09T11:00:00Z"),
    expected: { outcome: "HOLD", rules: ["R-DOC-02"] }, truth: inv("CN-112", -7_200, "PO-2031", "Acme Office Supplies, LLC", 1, "credit_note") },
  { id: "billto", tag: "Bill-to", title: "Billed to another company", file: "acme-AC-5540-billto.pdf", kind: "digital", launcher: false,
    envelope: env("billing@acmeoffice.com", "Invoice AC-5540", "Invoice attached.", "2026-11-12T09:00:00Z"),
    expected: { outcome: "HOLD", rules: ["R-DOC-03"] }, truth: inv("AC-5540", 12_990, "PO-2031", "Acme Office Supplies, LLC", 1) },
  { id: "unknown", tag: "Unknown vendor", title: "Vendor not in master", file: "wayne-WE-001.pdf", kind: "digital", launcher: false,
    envelope: env("finance@wayne-enterprises.com", "Invoice WE-001", "Please remit payment for the attached invoice.", "2026-11-12T13:00:00Z"),
    expected: { outcome: "HOLD", rules: ["R-VEN-01"] }, truth: inv("WE-001", 450_000, null, "Wayne Enterprises", 2) },
  { id: "bundled", tag: "Bundled", title: "Bundled project line", file: "pixel-PX-0412.pdf", kind: "digital", launcher: false,
    envelope: env("studio@pixelco.design", "Invoice PX-0412 — website refresh", "Final invoice for the website refresh project.", "2026-11-12T10:00:00Z"),
    expected: { outcome: "APPROVE", rules: ["R-BUN-01"] }, truth: inv("PX-0412", 350_000, "PO-2095", "Pixel & Co. Design Studio", 1) },
  { id: "taxincl", tag: "Tax-inclusive", title: "Tax embedded in prices", file: "acme-AC-5560-taxincl.pdf", kind: "digital", launcher: false,
    envelope: env("billing@acmeoffice.com", "Invoice AC-5560", "Invoice attached — prices include sales tax.", "2026-11-12T09:30:00Z"),
    expected: { outcome: "APPROVE", rules: [] }, truth: inv("AC-5560", 125_570, "PO-2033", "Acme Office Supplies, LLC", 3) },
  { id: "freight", tag: "Freight", title: "Freight line not on PO", file: "acme-AC-5571-freight.pdf", kind: "digital", launcher: false,
    envelope: env("billing@acmeoffice.com", "Invoice AC-5571", "Invoice for the office chairs, including delivery.", "2026-11-12T09:45:00Z"),
    expected: { outcome: "APPROVE", rules: ["R-FRT-01"] }, truth: inv("AC-5571", 129_637, "PO-2034", "Acme Office Supplies, LLC", 2) },
  { id: "nogrn", tag: "No receipt", title: "Goods not received yet", file: "umbrella-UP-4502.pdf", kind: "digital", launcher: false,
    envelope: env("accounts@umbrellaprint.com", "Invoice UP-4502", "Invoice for the A3 paper order.", "2026-11-12T15:30:00Z"),
    expected: { outcome: "HOLD", rules: ["R-GRN-02"] }, truth: inv("UP-4502", 53_584, "PO-2058", "Umbrella Print Co.", 1) },
  { id: "closedpo", tag: "Closed PO", title: "Billing a closed PO", file: "stark-SIP-7702.pdf", kind: "digital", launcher: false,
    envelope: env("invoices@starkparts.com", "Invoice SIP-7702", "Invoice attached for PO-2019.", "2026-11-12T16:00:00Z"),
    expected: { outcome: "HOLD", rules: ["R-PO-04"] }, truth: inv("SIP-7702", 18_673, "PO-2019", "Stark Industrial Parts", 1) },
  { id: "blocked", tag: "Blocked vendor", title: "Vendor is blocked", file: "vandelay-VI-3301.pdf", kind: "digital", launcher: false,
    envelope: env("art@vandelay.com", "Invoice VI-3301", "Latex gloves as discussed.", "2026-11-12T16:30:00Z"),
    expected: { outcome: "HOLD", rules: ["R-VEN-04"] }, truth: inv("VI-3301", 96_000, null, "Vandelay Imports", 1) },
  { id: "inr", tag: "INR / GST", title: "Indian GST invoice", file: "bharat-BOS-2026-118.pdf", kind: "digital", launcher: false,
    envelope: env("accounts@bharatoffice.in", "Tax Invoice BOS/2026/118", "Please find our GST tax invoice attached.", "2026-11-12T06:00:00Z"),
    expected: { outcome: "HOLD", rules: ["R-CUR-01", "R-VEN-01"] }, truth: inv("BOS/2026/118", 2_596_000, null, "Bharat Office Solutions Pvt Ltd", 2) },
  { id: "missing", tag: "Missing fields", title: "No invoice number or date", file: "soylent-nofields.pdf", kind: "digital", launcher: false,
    envelope: env("billing@soylentcatering.com", "Catering invoice", "Invoice for the all-hands lunch attached.", "2026-11-12T12:45:00Z"),
    expected: { outcome: "HOLD", rules: ["R-EXT-01"] }, truth: inv(null, 734_000, "PO-2090", "Soylent Catering", 3) },
  { id: "guide", tag: "Not an invoice", title: "The Zamp candidate guide", file: "zamp-candidate-guide.pdf", kind: "digital", launcher: false,
    envelope: env("hiring@zamp.ai", "ASA Case Study — Candidate Guide", "Everything you need to know to do your best work.", "2026-11-16T05:00:00Z"),
    expected: { outcome: "REJECT", rules: ["R-DOC-02"] }, truth: inv(null, null, null, null, 0, "other") },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);
