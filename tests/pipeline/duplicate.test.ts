import { describe, expect, it } from "vitest";
import { duplicateCheck } from "@/pipeline/stages/duplicate";
import { DEFAULT_POLICY } from "@/domain/policy";
import { PRIOR_INVOICES } from "../../fixtures/seed-data";
import { extractionFor } from "../../fixtures/doc-to-extraction";
import { fld, makeInvoice } from "../helpers/make-invoice";

const globexPriors = PRIOR_INVOICES.filter((p) => p.vendorId === "V-GLOBEX");

describe("duplicateCheck", () => {
  it("rejects a re-sent invoice with a tweaked number and new date (EC-3a)", () => {
    const r = duplicateCheck(extractionFor("ec3a"), "V-GLOBEX", globexPriors, DEFAULT_POLICY);
    expect(r.hits[0]).toMatchObject({ rule: "R-DUP-01", outcome: "REJECT", facts: { original: "INV-10422" } });
    expect(Number(r.hits[0].facts.score)).toBeCloseTo(0.911, 2);
  });

  it("lets next month's identical subscription invoice through (EC-3b)", () => {
    const r = duplicateCheck(extractionFor("ec3b"), "V-GLOBEX", globexPriors, DEFAULT_POLICY);
    expect(r.hits).toEqual([]);
    expect(r.data.best?.recurringGuard).toBe(true);
    expect(r.findings.some((f) => f.level === "info" && /different service period/.test(f.text))).toBe(true);
  });

  it("does not treat a near-identical order on a different PO as a duplicate", () => {
    const acmePrior = { invoiceId: "inv-1", vendorId: "V-ACME", invoiceNumber: "AC-5531", invoiceDate: "2026-11-08", totalCents: 125_559,
      servicePeriod: null, lineDescriptions: ["A4 copy paper, 10-ream case", "Ballpoint pens, box of 50", "Desk organizer"],
      outcome: "APPROVE" as const, sha256: "x", poNumber: "PO-2031" };
    const x = extractionFor("taxincl"); // AC-5560: same items and total within 1%, but billed against PO-2033
    expect(duplicateCheck(x, "V-ACME", [acmePrior], DEFAULT_POLICY, null).hits[0]?.rule).toBe("R-DUP-01"); // without the PO it looks like a resend
    const r = duplicateCheck(x, "V-ACME", [acmePrior], DEFAULT_POLICY, "PO-2033");
    expect(r.hits).toEqual([]);
    expect(r.findings.some((f) => /different purchase order \(PO-2033 vs PO-2031\)/.test(f.text))).toBe(true);
    // the same PO, or an identical invoice number, is never excused
    expect(duplicateCheck(x, "V-ACME", [acmePrior], DEFAULT_POLICY, "PO-2031").hits[0]?.rule).toBe("R-DUP-01");
    expect(duplicateCheck(x, "V-ACME", [{ ...acmePrior, invoiceNumber: "AC-5560" }], DEFAULT_POLICY, "PO-2033").hits[0]?.rule).toBe("R-DUP-01");
  });

  it("would have held EC-3b without the recurring guard", () => {
    const priors = globexPriors.map((p) => ({ ...p, servicePeriod: null }));
    const r = duplicateCheck({ ...extractionFor("ec3b"), servicePeriod: fld(null) }, "V-GLOBEX", priors, DEFAULT_POLICY);
    expect(r.hits[0]).toMatchObject({ rule: "R-DUP-02", outcome: "HOLD" });
  });

  it("treats an identical invoice number from the same vendor as a duplicate", () => {
    const r = duplicateCheck(makeInvoice({ invoiceNumber: fld("INV 10422"), total: fld(1) }, "ec3b"), "V-GLOBEX", globexPriors, DEFAULT_POLICY);
    expect(r.hits[0]).toMatchObject({ rule: "R-DUP-01", facts: { score: 1 } });
  });

  it("only compares against the same vendor", () => {
    const r = duplicateCheck(extractionFor("ec3a"), "V-ACME", globexPriors, DEFAULT_POLICY);
    expect(r.data.best).toBeNull();
    expect(r.hits).toEqual([]);
  });
});
