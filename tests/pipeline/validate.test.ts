import { describe, expect, it } from "vitest";
import { validate } from "@/pipeline/stages/validate";
import { DEFAULT_POLICY } from "@/domain/policy";
import { COMPANY } from "../../fixtures/seed-data";
import { fld, line, makeInvoice } from "../helpers/make-invoice";
import { extractionFor } from "../../fixtures/doc-to-extraction";
import type { ExtractedInvoice } from "@/domain/types";

const ctx = (pageTexts: string[] = [], kind: "digital" | "scanned" = "scanned") =>
  ({ pageTexts, kind, company: COMPANY, policy: DEFAULT_POLICY });
const run = (x: ExtractedInvoice, c = ctx()) => validate(x, c);
const rules = (x: ExtractedInvoice, c = ctx()) => run(x, c).hits.map((h) => h.rule);

describe("validate — document gates", () => {
  it("passes the clean happy invoice", () => {
    const r = run(makeInvoice());
    expect(r.hits).toEqual([]);
    expect(r.data.arithmeticOk).toBe(true);
  });

  it("rejects non-payable documents and keeps the model's reason as evidence", () => {
    const stmt = run(makeInvoice({ documentType: "statement" }));
    expect(stmt.hits[0]).toMatchObject({ rule: "R-DOC-02", outcome: "REJECT" });
    expect(stmt.halt).toBe(true);
    const notice = run(extractionFor("notice"));
    expect(notice.hits[0]).toMatchObject({ rule: "R-DOC-02", outcome: "REJECT", facts: { reason: "Informational vendor letter, not a request for payment" } });
  });

  it("holds credit notes instead of rejecting them", () => {
    expect(run(makeInvoice({ documentType: "credit_note" })).hits[0]).toMatchObject({ rule: "R-DOC-02", outcome: "HOLD" });
  });

  it("checks the bill-to entity against our company and aliases", () => {
    expect(rules(makeInvoice({ billTo: fld("Northwind Logistics GmbH") }))).toContain("R-DOC-03");
    expect(rules(makeInvoice({ billTo: fld("NORTHWIND LABS INC") }))).not.toContain("R-DOC-03");
  });

  it("accepts a bill-to block that includes our address, but not a look-alike entity with one", () => {
    const addr = "500 Howard Street, Suite 300\nSan Francisco, CA 94105\nUnited States";
    expect(rules(makeInvoice({ billTo: fld(`Northwind Labs, Inc.\n${addr}`) }))).not.toContain("R-DOC-03");
    expect(rules(makeInvoice({ billTo: fld("Northwind Labs, Inc., 500 Howard Street, Suite 300, San Francisco, CA 94105") }))).not.toContain("R-DOC-03");
    expect(rules(makeInvoice({ billTo: fld("Northwind Logistics GmbH\nSpeicherstraße 12\n20457 Hamburg\nGermany") }))).toContain("R-DOC-03");
  });

  it("holds non-USD invoices without halting, and assumes USD when currency is missing", () => {
    const inr = run(makeInvoice({ currency: fld("INR") }));
    expect(inr.hits.map((h) => h.rule)).toContain("R-CUR-01");
    expect(inr.halt).toBeFalsy();
    const none = run(makeInvoice({ currency: fld(null) }));
    expect(none.hits).toEqual([]);
    expect(none.findings.some((f) => f.level === "info" && /assumed USD/.test(f.text))).toBe(true);
  });

  it("names every missing required field", () => {
    const r = run(makeInvoice({ total: fld(null) }));
    expect(r.hits[0]).toMatchObject({ rule: "R-EXT-01", outcome: "HOLD" });
    expect(r.hits[0].facts.missing).toContain("total");
    const both = run(extractionFor("missing"));
    expect(String(both.hits[0].facts.missing)).toMatch(/invoice number.*invoice date/);
    expect(both.halt).toBe(true);
  });
});

describe("validate — lines and tax", () => {
  it("treats a lump-sum line as quantity 1", () => {
    const r = run(extractionFor("bundled"));
    expect(r.hits).toEqual([]);
    expect(r.data.netLines[0]).toMatchObject({ quantity: 1, unitCents: 350000, amountCents: 350000 });
  });

  it("holds when a line amount cannot be determined", () => {
    const r = run(makeInvoice({ lines: [{ quantity: null, unitPrice: null, amount: null }] }));
    expect(r.hits[0]).toMatchObject({ rule: "R-EXT-01", facts: { missing: "amount for line 1" } });
  });

  it("keeps discounts as favourable lines and still reconciles", () => {
    const x = makeInvoice();
    x.lines.push(line({ description: "Loyalty discount", lineType: null, quantity: null, unitPrice: null, amount: -25 }));
    x.subtotal = fld(1134.9);
    x.total = fld(1230.59);
    const r = run(x);
    expect(r.data.netLines.at(-1)).toMatchObject({ lineType: "discount", amountCents: -2500 });
    expect(r.data.arithmeticOk).toBe(true);
  });

  it("converts tax-inclusive prices back to pre-tax amounts", () => {
    const r = run(extractionFor("taxincl"));
    expect(r.hits).toEqual([]);
    expect(r.data.arithmeticOk).toBe(true);
    const units = r.data.netLines.map((l) => l.unitCents);
    [4250, 1899, 2400].forEach((u, i) => expect(Math.abs(units[i] - u)).toBeLessThanOrEqual(1));
  });

  it("holds tax it cannot reconcile", () => {
    expect(rules(makeInvoice({ taxInclusive: true, taxTotal: fld(null), subtotal: fld(null), total: fld(1159.9) }))).toContain("R-TAX-01");
    const thirty = makeInvoice({ lines: [{ amount: 1000, quantity: 1, unitPrice: 1000 }], subtotal: fld(1000), taxTotal: fld(300), total: fld(1300) });
    expect(rules(thirty)).toContain("R-TAX-01");
  });

  it("counts tax printed as a line as tax, not as a line item", () => {
    const x = makeInvoice({ taxTotal: fld(null) });
    x.lines.push(line({ description: "Sales tax 8.25%", lineType: "tax", quantity: null, unitPrice: null, amount: 95.69 }));
    const r = run(x);
    expect(r.data.netLines).toHaveLength(3);
    expect(r.data.taxCents).toBe(9569);
    expect(r.data.arithmeticOk).toBe(true);
  });
});

describe("validate — arithmetic and evidence", () => {
  it("explains a mismatch between line items and the printed subtotal", () => {
    const r = run(extractionFor("ec5"));
    expect(r.data.arithmeticOk).toBe(false);
    expect(r.data.arithmeticReason).toBe("Line items sum to $7,340.00 but the invoice states $7,430.00");
    expect(r.hits).toEqual([]); // the orchestrator decides re-extract → R-EXT-02
  });

  it("tolerates one cent of rounding per line", () => {
    const lines = Array.from({ length: 9 }, () => ({ quantity: 1, unitPrice: 10.01, amount: 10.01 }));
    const r = run(makeInvoice({ lines, subtotal: fld(90), taxTotal: fld(0), total: fld(90) }));
    expect(r.data.arithmeticOk).toBe(true);
  });

  it("warns (without a rule) when a quote is not on the page", () => {
    const x = makeInvoice({ total: fld(1255.59, "$9,999.00") });
    const r = run(x, ctx(["Total Due $1,255.59 AC-5531"], "digital"));
    expect(r.hits).toEqual([]);
    expect(r.findings.some((f) => f.level === "warn" && /total/i.test(f.text))).toBe(true);
    expect(r.data.quoteChecks.find((q) => q.field === "total")?.found).toBe(false);
  });
});
