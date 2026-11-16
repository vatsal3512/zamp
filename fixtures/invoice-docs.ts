/**
 * Printed content of every generated fixture document (amounts in decimal currency units, as printed).
 * Used by scripts/generate-fixtures.ts to render PDFs, and by tests to build the matching ExtractedInvoice.
 */
import type { LineType } from "@/domain/types";

export type Layout = "classic" | "modern" | "minimal" | "gst" | "statement" | "credit";

export interface DocLine { description: string; qty: number | null; unit: number | null; amount: number; lineType: LineType; hsn?: string }
export interface Party { name: string; address: string[]; taxId?: string; email?: string; phone?: string }

export interface InvoiceDoc {
  scenarioId: string; layout: Layout; title: string;
  vendor: Party; billTo: Party;
  invoiceNumber: string | null; invoiceDate: string | null; dueDate: string | null;
  poNumber: string | null; servicePeriod: string | null; // "YYYY-MM"
  currency: "USD" | "INR"; lines: DocLine[];
  subtotal: number | null; taxes: { label: string; amount: number }[]; total: number;
  taxInclusive: boolean; note?: string;
  bank: { bankName: string; routing: string; account: string; label?: string } | null;
}

const NORTHWIND: Party = { name: "Northwind Labs, Inc.", address: ["500 Howard Street, Suite 300", "San Francisco, CA 94105", "United States"] };
const ACME: Party = { name: "Acme Office Supplies, LLC", address: ["1200 Market Street", "Philadelphia, PA 19107"], taxId: "84-1234567", email: "billing@acmeoffice.com", phone: "+1 (215) 555-0142" };
const INITECH: Party = { name: "Initech Managed Services", address: ["4120 Freidrich Lane", "Austin, TX 78744"], taxId: "33-1112223", email: "ar@initech.io" };
const UMBRELLA: Party = { name: "Umbrella Print Co.", address: ["88 Raccoon Avenue", "Columbus, OH 43215"], taxId: "46-5550192", email: "accounts@umbrellaprint.com" };
const GLOBEX: Party = { name: "Globex Corporation", address: ["1 Globex Plaza", "Cypress Creek, OR 97005"], taxId: "94-7654321", email: "billing@globex.com" };
const STARK: Party = { name: "Stark Industrial Parts", address: ["77 Foundry Road", "Pittsburgh, PA 15222"], taxId: "27-3048816", email: "invoices@starkparts.com" };
const SOYLENT: Party = { name: "Soylent Catering", address: ["19 Green Street", "Oakland, CA 94607"], taxId: "52-8817340", email: "billing@soylentcatering.com" };
const PIXEL: Party = { name: "Pixel & Co. Design Studio", address: ["300 Valencia Street", "San Francisco, CA 94103"], taxId: "81-2093374", email: "studio@pixelco.design" };
const VANDELAY: Party = { name: "Vandelay Imports", address: ["129 West 81st Street", "New York, NY 10024"], taxId: "13-6620551", email: "art@vandelay.com" };
const WAYNE: Party = { name: "Wayne Enterprises", address: ["1007 Mountain Drive", "Gotham, NJ 07001"], taxId: "61-0042007", email: "finance@wayne-enterprises.com" };
const BHARAT: Party = { name: "Bharat Office Solutions Pvt Ltd", address: ["No. 42, 3rd Cross, Indiranagar", "Bengaluru, Karnataka 560038", "India"], taxId: "GSTIN 29ABCDE1234F1Z5", email: "accounts@bharatoffice.in" };

const bank = (bankName: string, acct: string, label?: string) => {
  const [routing, account] = acct.split("-");
  return { bankName, routing, account, label };
};
const salesTax = (base: number) => [{ label: "Sales tax (8.25%)", amount: Math.round(base * 0.0825 * 100) / 100 }];
const g = (description: string, qty: number, unit: number, lineType: LineType = "goods"): DocLine =>
  ({ description, qty, unit, amount: Math.round(qty * unit * 100) / 100, lineType });

const base = (o: Partial<InvoiceDoc> & Pick<InvoiceDoc, "scenarioId" | "layout" | "vendor" | "lines" | "total">): InvoiceDoc => ({
  title: "INVOICE", billTo: NORTHWIND, invoiceNumber: null, invoiceDate: null, dueDate: null, poNumber: null,
  servicePeriod: null, currency: "USD", subtotal: null, taxes: [], taxInclusive: false, bank: null, ...o,
});

export const INVOICE_DOCS: InvoiceDoc[] = [
  base({ scenarioId: "happy", layout: "classic", vendor: ACME, invoiceNumber: "AC-5531", invoiceDate: "2026-11-08", dueDate: "2026-12-08", poNumber: "PO-2031",
    lines: [g("A4 copy paper, 10-ream case", 20, 42.5), g("Ballpoint pens, box of 50", 10, 18.99), g("Desk organizer", 5, 24.0)],
    subtotal: 1159.9, taxes: salesTax(1159.9), total: 1255.59, bank: bank("First Republic Trust", "021000021-4417730001") }),
  base({ scenarioId: "ec1", layout: "modern", vendor: INITECH, invoiceNumber: "INI-1101", invoiceDate: "2026-11-10", dueDate: "2026-12-10", poNumber: "PO-2041", servicePeriod: "2026-10",
    lines: [g("Managed support hours", 140, 125.0, "service")], subtotal: 17500, total: 17500, bank: bank("Lone Star Bank", "026009593-8812005521") }),
  base({ scenarioId: "ec2", layout: "classic", vendor: STARK, invoiceNumber: "SIP-7781", invoiceDate: "2026-11-09", dueDate: "2026-12-09",
    lines: [g("Hex bolt M8x40, box of 100", 12, 34.5), g("Steel washer M8, box of 200", 12, 12.75), g("Nylon lock nut M8, box of 100", 6, 28.9)],
    subtotal: 740.4, taxes: salesTax(740.4), total: 801.48, bank: bank("Steel City Savings", "071000013-3301776620") }),
  base({ scenarioId: "ec3a", layout: "minimal", vendor: GLOBEX, invoiceNumber: "INV10422-R", invoiceDate: "2026-11-12", dueDate: "2026-12-12", poNumber: "PO-2063", servicePeriod: "2026-10",
    lines: [g("Monthly platform subscription", 1, 2400, "service")], subtotal: 2400, total: 2400, bank: bank("Pacific Commerce Bank", "121000248-5560910492") }),
  base({ scenarioId: "ec3b", layout: "minimal", vendor: GLOBEX, invoiceNumber: "INV-10587", invoiceDate: "2026-11-05", dueDate: "2026-12-05", poNumber: "PO-2063", servicePeriod: "2026-11",
    lines: [g("Monthly platform subscription", 1, 2400, "service")], subtotal: 2400, total: 2400, bank: bank("Pacific Commerce Bank", "121000248-5560910492") }),
  base({ scenarioId: "ec4", layout: "minimal", vendor: GLOBEX, invoiceNumber: "INV-10601", invoiceDate: "2026-11-13", dueDate: "2026-11-20", poNumber: "PO-2064",
    lines: [g("Rack server maintenance kit", 2, 4935)], subtotal: 9870, total: 9870,
    bank: bank("Coastal Federal Bank", "121000248-9930017731", "PLEASE NOTE OUR NEW BANK DETAILS"), note: "Payment due within 7 days to the updated account below." }),
  base({ scenarioId: "ec5", layout: "modern", vendor: SOYLENT, invoiceNumber: "SC-2219", invoiceDate: "2026-11-11", dueDate: "2026-12-11", poNumber: "PO-2090",
    lines: [g("Catering — all-hands lunch, per head", 320, 18.5, "service"), g("Coffee & beverage service", 1, 1180, "service"), g("Delivery & setup", 1, 240, "service")],
    subtotal: 7430, total: 7430, note: "Catering services — sales tax exempt.", bank: bank("Bay Credit Union", "091000019-6610028841") }),
  base({ scenarioId: "pv", layout: "classic", vendor: UMBRELLA, invoiceNumber: "UP-4410", invoiceDate: "2026-11-11", dueDate: "2026-12-11", poNumber: "PO-2052",
    lines: [g("Toner cartridge, black, high-yield", 40, 26.05)], subtotal: 1042, taxes: salesTax(1042), total: 1127.97,
    note: "Pricing reflects our updated rate card effective November 1.", bank: bank("Buckeye National", "011000138-2290043318") }),
  base({ scenarioId: "stmt", layout: "statement", title: "STATEMENT OF ACCOUNT", vendor: ACME, invoiceDate: "2026-10-31",
    lines: [
      { description: "Invoice AC-5488 · 2026-10-03", qty: null, unit: null, amount: 640.2, lineType: "other" },
      { description: "Invoice AC-5502 · 2026-10-17", qty: null, unit: null, amount: 1129, lineType: "other" },
      { description: "Payment received · 2026-10-24 — thank you", qty: null, unit: null, amount: -640.2, lineType: "other" },
    ], total: 1129, note: "This is a statement for your records — not an invoice. Do not pay from this statement." }),
  base({ scenarioId: "credit", layout: "credit", title: "CREDIT NOTE", vendor: ACME, invoiceNumber: "CN-112", invoiceDate: "2026-11-09", poNumber: "PO-2031",
    lines: [{ description: "Returned — Desk organizer (damaged)", qty: 3, unit: -24, amount: -72, lineType: "goods" }], subtotal: -72, total: -72,
    note: "Credit against invoice AC-5379. This amount will be applied to your account balance." }),
  base({ scenarioId: "billto", layout: "classic", vendor: ACME, invoiceNumber: "AC-5540", invoiceDate: "2026-11-11", dueDate: "2026-12-11", poNumber: "PO-2031",
    billTo: { name: "Northwind Logistics GmbH", address: ["Speicherstraße 12", "20457 Hamburg", "Germany"] },
    lines: [g("Desk organizer", 5, 24.0)], subtotal: 120, taxes: salesTax(120), total: 129.9, bank: bank("First Republic Trust", "021000021-4417730001") }),
  base({ scenarioId: "unknown", layout: "modern", vendor: WAYNE, invoiceNumber: "WE-001", invoiceDate: "2026-11-10", dueDate: "2026-11-25",
    lines: [g("Security consulting — Q4 assessment", 1, 3800, "service"), g("Travel expenses", 1, 700, "other")], subtotal: 4500, total: 4500,
    bank: bank("Gotham Trust", "021202337-5544332211") }),
  base({ scenarioId: "bundled", layout: "minimal", vendor: PIXEL, invoiceNumber: "PX-0412", invoiceDate: "2026-11-11", dueDate: "2026-12-11", poNumber: "PO-2095",
    lines: [{ description: "Website refresh — project deliverable", qty: null, unit: null, amount: 3500, lineType: "service" }], subtotal: 3500, total: 3500,
    bank: bank("Mission Bank", "122105155-7781230094") }),
  base({ scenarioId: "taxincl", layout: "modern", vendor: ACME, invoiceNumber: "AC-5560", invoiceDate: "2026-11-11", dueDate: "2026-12-11", poNumber: "PO-2033",
    lines: [g("A4 copy paper, 10-ream case", 20, 46.01), g("Ballpoint pens, box of 50", 10, 20.56), g("Desk organizer", 5, 25.98)],
    taxInclusive: true, total: 1255.7, note: "Prices include 8.25% sales tax: $95.80", bank: bank("First Republic Trust", "021000021-4417730001") }),
  base({ scenarioId: "freight", layout: "classic", vendor: ACME, invoiceNumber: "AC-5571", invoiceDate: "2026-11-11", dueDate: "2026-12-11", poNumber: "PO-2034",
    lines: [g("Ergonomic office chair", 4, 289.0), g("Shipping & handling", 1, 45.0, "freight")], subtotal: 1201,
    taxes: [{ label: "Sales tax (8.25% on goods)", amount: 95.37 }], total: 1296.37, bank: bank("First Republic Trust", "021000021-4417730001") }),
  base({ scenarioId: "nogrn", layout: "classic", vendor: UMBRELLA, invoiceNumber: "UP-4502", invoiceDate: "2026-11-12", dueDate: "2026-12-12", poNumber: "PO-2058",
    lines: [g("Glossy A3 paper, ream", 30, 16.5)], subtotal: 495, taxes: salesTax(495), total: 535.84, bank: bank("Buckeye National", "011000138-2290043318") }),
  base({ scenarioId: "closedpo", layout: "classic", vendor: STARK, invoiceNumber: "SIP-7702", invoiceDate: "2026-11-12", dueDate: "2026-12-12", poNumber: "PO-2019",
    lines: [g("Hex bolt M8x40, box of 100", 5, 34.5)], subtotal: 172.5, taxes: salesTax(172.5), total: 186.73, bank: bank("Steel City Savings", "071000013-3301776620") }),
  base({ scenarioId: "blocked", layout: "modern", vendor: VANDELAY, invoiceNumber: "VI-3301", invoiceDate: "2026-11-12", dueDate: "2026-12-12",
    lines: [g("Latex gloves, case of 1000", 20, 48.0)], subtotal: 960, total: 960, bank: bank("Hudson Merchants Bank", "026013673-1180024410") }),
  base({ scenarioId: "inr", layout: "gst", title: "TAX INVOICE", vendor: BHARAT, invoiceNumber: "BOS/2026/118", invoiceDate: "2026-11-12", dueDate: "2026-12-12", currency: "INR",
    lines: [{ ...g("A4 paper ream (75 GSM)", 50, 350), hsn: "4802" }, { ...g("Stapler, heavy duty", 10, 450), hsn: "8472" }], subtotal: 22000,
    taxes: [{ label: "CGST @ 9%", amount: 1980 }, { label: "SGST @ 9%", amount: 1980 }], total: 25960,
    bank: { bankName: "State Bank of India, Indiranagar", routing: "IFSC SBIN0001234", account: "30112233445" } }),
  base({ scenarioId: "missing", layout: "modern", vendor: SOYLENT, poNumber: "PO-2090",
    lines: [g("Catering — all-hands lunch, per head", 320, 18.5, "service"), g("Coffee & beverage service", 1, 1180, "service"), g("Delivery & setup", 1, 240, "service")],
    subtotal: 7340, total: 7340, note: "Catering services — sales tax exempt.", bank: bank("Bay Credit Union", "091000019-6610028841") }),
];

export const docFor = (scenarioId: string) => INVOICE_DOCS.find((d) => d.scenarioId === scenarioId);
