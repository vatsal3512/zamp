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
