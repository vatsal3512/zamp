import { describe, expect, it } from "vitest";
import { vendorCheck } from "@/pipeline/stages/vendor";
import { VENDORS } from "../../fixtures/seed-data";
import { SCENARIOS } from "../../fixtures/scenarios";
import { extractionFor } from "../../fixtures/doc-to-extraction";
import { fld, makeInvoice } from "../helpers/make-invoice";

const envelopeOf = (id: string) => SCENARIOS.find((s) => s.id === id)!.envelope;

describe("vendorCheck", () => {
  it("resolves a known vendor with matching bank details and sender", () => {
    const r = vendorCheck(extractionFor("happy"), VENDORS, envelopeOf("happy"));
    expect(r.data.vendor?.id).toBe("V-ACME");
    expect(r.hits).toEqual([]);
  });

  it("flags both changed bank details and a look-alike sender domain (EC-4)", () => {
    const r = vendorCheck(extractionFor("ec4"), VENDORS, envelopeOf("ec4"));
    const bank = r.hits.find((h) => h.rule === "R-VEN-02");
    expect(bank?.facts).toMatchObject({ invoiceLast4: "7731", masterLast4: "0492" });
    expect(r.hits.find((h) => h.rule === "R-VEN-03")?.facts).toMatchObject({ senderDomain: "globex-billing.co", expectedDomain: "globex.com" });
  });

  it("accepts a subdomain of the vendor's domain", () => {
    const r = vendorCheck(extractionFor("ec3b"), VENDORS, { ...envelopeOf("ec3b"), from: "ap@mail.globex.com" });
    expect(r.hits.map((h) => h.rule)).not.toContain("R-VEN-03");
  });

  it("notes that the sender check does not apply to uploads", () => {
    const r = vendorCheck(extractionFor("happy"), VENDORS, null);
    expect(r.findings.some((f) => /n\/a/.test(f.text))).toBe(true);
  });

  it("holds an unknown vendor and stops", () => {
    const r = vendorCheck(extractionFor("unknown"), VENDORS, envelopeOf("unknown"));
    expect(r.hits[0].rule).toBe("R-VEN-01");
    expect(r.halt).toBe(true);
  });

  it("holds a blocked vendor separately from an unknown one", () => {
    const r = vendorCheck(extractionFor("blocked"), VENDORS, envelopeOf("blocked"));
    expect(r.hits[0]).toMatchObject({ rule: "R-VEN-04", facts: { status: "blocked" } });
    expect(r.halt).toBe(true);
  });

  it("matches on tax ID even when the name is written differently", () => {
    const r = vendorCheck(makeInvoice({ vendorName: fld("ACME OFFICE"), vendorTaxId: fld("841234567") }), VENDORS, null);
    expect(r.data.matchedBy).toBe("taxId");
  });
});
