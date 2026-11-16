import { DEFAULT_POLICY } from "@/domain/policy";
import type { GoodsReceipt, Policy, PoLine, PriorInvoice, PurchaseOrder, Vendor } from "@/domain/types";

export const COMPANY = { name: "Northwind Labs, Inc.", aliases: ["Northwind Labs", "Northwind Labs Inc"] };

export const VENDORS: Vendor[] = [
  { id: "V-ACME", legalName: "Acme Office Supplies, LLC", aliases: ["Acme Office Supplies", "Acme"], taxId: "84-1234567", status: "approved", bankAccount: "021000021-4417730001", emailDomain: "acmeoffice.com", contactOnFile: "billing@acmeoffice.com" },
  { id: "V-INITECH", legalName: "Initech Managed Services", aliases: ["Initech"], taxId: "33-1112223", status: "approved", bankAccount: "026009593-8812005521", emailDomain: "initech.io", contactOnFile: "ar@initech.io" },
  { id: "V-UMBRELLA", legalName: "Umbrella Print Co.", aliases: ["Umbrella Print"], taxId: "46-5550192", status: "approved", bankAccount: "011000138-2290043318", emailDomain: "umbrellaprint.com", contactOnFile: "accounts@umbrellaprint.com" },
  { id: "V-GLOBEX", legalName: "Globex Corporation", aliases: ["Globex", "Globex Corp"], taxId: "94-7654321", status: "approved", bankAccount: "121000248-5560910492", emailDomain: "globex.com", contactOnFile: "billing@globex.com" },
  { id: "V-STARK", legalName: "Stark Industrial Parts", aliases: ["Stark Industrial"], taxId: "27-3048816", status: "approved", bankAccount: "071000013-3301776620", emailDomain: "starkparts.com", contactOnFile: "invoices@starkparts.com" },
  { id: "V-SOYLENT", legalName: "Soylent Catering", aliases: ["Soylent Catering Co."], taxId: "52-8817340", status: "approved", bankAccount: "091000019-6610028841", emailDomain: "soylentcatering.com", contactOnFile: "billing@soylentcatering.com" },
  { id: "V-PIXEL", legalName: "Pixel & Co. Design Studio", aliases: ["Pixel & Co.", "Pixel and Co Design Studio"], taxId: "81-2093374", status: "approved", bankAccount: "122105155-7781230094", emailDomain: "pixelco.design", contactOnFile: "studio@pixelco.design" },
  { id: "V-VANDELAY", legalName: "Vandelay Imports", aliases: ["Vandelay Industries"], taxId: "13-6620551", status: "blocked", bankAccount: "026013673-1180024410", emailDomain: "vandelay.com", contactOnFile: "art@vandelay.com" },
];

const L = (lineNo: number, description: string, quantity: number, unitPriceCents: number): PoLine => ({ lineNo, description, quantity, unitPriceCents });
const total = (lines: PoLine[]) => lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
const po = (poNumber: string, vendorId: string, matchType: PurchaseOrder["matchType"], lines: PoLine[], billedToDateCents = 0, status: PurchaseOrder["status"] = "open"): PurchaseOrder =>
  ({ poNumber, vendorId, matchType, currency: "USD", lines, totalCents: total(lines), billedToDateCents, status });

const officeLines = () => [L(1, "A4 copy paper, 10-ream case", 20, 4250), L(2, "Ballpoint pens, box of 50", 10, 1899), L(3, "Desk organizer", 5, 2400)];

export const PURCHASE_ORDERS: PurchaseOrder[] = [
  po("PO-2031", "V-ACME", "3-way", officeLines()),
  po("PO-2033", "V-ACME", "3-way", officeLines()),
  po("PO-2034", "V-ACME", "3-way", [L(1, "Ergonomic office chair", 4, 28900)]),
  po("PO-2041", "V-INITECH", "2-way", [L(1, "Managed support hours", 384, 12500)], 3_200_000),
  po("PO-2052", "V-UMBRELLA", "3-way", [L(1, "Toner cartridge, black, high-yield", 40, 2500)]),
  po("PO-2058", "V-UMBRELLA", "3-way", [L(1, "Glossy A3 paper, ream", 30, 1650)]),
  po("PO-2063", "V-GLOBEX", "2-way", [L(1, "Monthly platform subscription", 12, 240000)], 240_000),
  po("PO-2064", "V-GLOBEX", "2-way", [L(1, "Rack server maintenance kit", 2, 493500)]),
  po("PO-2077", "V-STARK", "3-way", [L(1, "Hex bolt M8x40, box of 100", 12, 3450), L(2, "Steel washer M8, box of 200", 12, 1275), L(3, "Nylon lock nut M8, box of 100", 6, 2890)]),
  po("PO-2081", "V-STARK", "3-way", [L(1, "Hydraulic hose 1/2in, 50ft", 4, 18900), L(2, "Hose clamp kit", 10, 1450)]),
  po("PO-2019", "V-STARK", "3-way", [L(1, "Hex bolt M8x40, box of 100", 10, 3450)], 34_500, "closed"),
  po("PO-2090", "V-SOYLENT", "2-way", [L(1, "Catering — all-hands lunch, per head", 320, 1850), L(2, "Coffee & beverage service", 1, 118000), L(3, "Delivery & setup", 1, 24000)]),
  po("PO-2095", "V-PIXEL", "2-way", [L(1, "Discovery & design", 1, 100000), L(2, "Build & integration", 1, 200000), L(3, "QA & launch", 1, 50000)]),
];

const fullReceipt = (grnNumber: string, poNumber: string, receivedAt: string): GoodsReceipt => {
  const p = PURCHASE_ORDERS.find((x) => x.poNumber === poNumber)!;
  return { grnNumber, poNumber, receivedAt, lines: p.lines.map((l) => ({ lineNo: l.lineNo, quantityReceived: l.quantity })) };
};

export const GOODS_RECEIPTS: GoodsReceipt[] = [
  fullReceipt("GRN-1031", "PO-2031", "2026-11-02"),
  fullReceipt("GRN-1033", "PO-2033", "2026-11-03"),
  fullReceipt("GRN-1034", "PO-2034", "2026-11-04"),
  fullReceipt("GRN-1052", "PO-2052", "2026-11-05"),
  fullReceipt("GRN-1077", "PO-2077", "2026-11-06"),
  fullReceipt("GRN-1019", "PO-2019", "2026-10-12"),
];

export const PRIOR_INVOICES: PriorInvoice[] = [
  { invoiceId: "inv-prior-ini-0901", vendorId: "V-INITECH", invoiceNumber: "INI-0901", invoiceDate: "2026-09-05", totalCents: 1_600_000, servicePeriod: "2026-08", lineDescriptions: ["Managed support hours"], outcome: "APPROVE", sha256: "0".repeat(63) + "1" },
  { invoiceId: "inv-prior-ini-1001", vendorId: "V-INITECH", invoiceNumber: "INI-1001", invoiceDate: "2026-10-05", totalCents: 1_600_000, servicePeriod: "2026-09", lineDescriptions: ["Managed support hours"], outcome: "APPROVE", sha256: "0".repeat(63) + "2" },
  { invoiceId: "inv-prior-inv-10422", vendorId: "V-GLOBEX", invoiceNumber: "INV-10422", invoiceDate: "2026-10-03", totalCents: 240_000, servicePeriod: "2026-10", lineDescriptions: ["Monthly platform subscription"], outcome: "APPROVE", sha256: "0".repeat(63) + "3" },
];

export interface SeedData {
  vendors: Vendor[]; purchaseOrders: PurchaseOrder[]; goodsReceipts: GoodsReceipt[]; priorInvoices: PriorInvoice[]; policy: Policy;
}

export const SEED: SeedData = {
  vendors: VENDORS,
  purchaseOrders: PURCHASE_ORDERS,
  goodsReceipts: GOODS_RECEIPTS,
  priorInvoices: PRIOR_INVOICES,
  policy: DEFAULT_POLICY,
};
