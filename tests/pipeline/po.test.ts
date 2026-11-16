import { describe, expect, it } from "vitest";
import { poLookup } from "@/pipeline/stages/po";
import { DEFAULT_POLICY } from "@/domain/policy";
import { PURCHASE_ORDERS, VENDORS } from "../../fixtures/seed-data";
import { extractionFor } from "../../fixtures/doc-to-extraction";
import { fld, makeInvoice, makeNetLines } from "../helpers/make-invoice";
import type { ExtractedInvoice, NetLine } from "@/domain/types";

const vendor = (id: string) => VENDORS.find((v) => v.id === id)!;
const getPo = (n: string) => PURCHASE_ORDERS.find((p) => p.poNumber === n) ?? null;
const openPos = (vendorId: string) => PURCHASE_ORDERS.filter((p) => p.vendorId === vendorId && p.status === "open");
const run = (x: ExtractedInvoice, lines: NetLine[], vendorId: string) =>
  poLookup(x, lines, vendor(vendorId), getPo, openPos(vendorId), DEFAULT_POLICY, (id) => vendor(id).legalName);

const acmeLines = makeNetLines([["A4 copy paper, 10-ream case", 20, 4250], ["Ballpoint pens, box of 50", 10, 1899], ["Desk organizer", 5, 2400]]);
const starkLines = makeNetLines([["Hex bolt M8x40, box of 100", 12, 3450], ["Steel washer M8, box of 200", 12, 1275], ["Nylon lock nut M8, box of 100", 6, 2890]]);

describe("poLookup", () => {
  it("uses an explicit PO reference", () => {
    const r = run(extractionFor("happy"), acmeLines, "V-ACME");
    expect(r.data.po?.poNumber).toBe("PO-2031");
    expect(r.data.inferred).toBe(false);
    expect(r.hits).toEqual([]);
  });

  it("infers the PO from line items when none is printed (EC-2), and says so", () => {
    const r = run(extractionFor("ec2"), starkLines, "V-STARK");
    expect(r.data.po?.poNumber).toBe("PO-2077");
    expect(r.data.inferred).toBe(true);
    expect(r.hits).toEqual([{ rule: "R-PO-02", outcome: "NOTE", facts: { poNumber: "PO-2077", score: 1 } }]);
  });

  it("refuses to pick between two equally plausible POs", () => {
    const r = run(makeInvoice({ poNumber: fld(null) }), acmeLines, "V-ACME");
    expect(r.hits[0].rule).toBe("R-PO-01");
    expect(String(r.hits[0].facts.candidates)).toMatch(/PO-2031.*PO-2033|PO-2033.*PO-2031/);
    expect(r.halt).toBe(true);
  });

  it("holds when the PO is unknown and nothing matches", () => {
    const lines = makeNetLines([["Moon rocks", 1, 100000]]);
    const r = run(makeInvoice({ poNumber: fld("PO-9999") }), lines, "V-ACME");
    expect(r.hits[0]).toMatchObject({ rule: "R-PO-01", facts: { candidates: "none" } });
  });

  it("holds an invoice against a closed PO", () => {
    const r = run(extractionFor("closedpo"), makeNetLines([["Hex bolt M8x40, box of 100", 5, 3450]]), "V-STARK");
    expect(r.hits[0]).toMatchObject({ rule: "R-PO-04", facts: { poNumber: "PO-2019", status: "closed" } });
    expect(r.halt).toBe(true);
  });

  it("holds an invoice citing another vendor's PO", () => {
    const r = run(makeInvoice({ poNumber: fld("PO-2041") }), acmeLines, "V-ACME");
    expect(r.hits[0].rule).toBe("R-PO-01");
    expect(String(r.hits[0].facts.reason)).toContain("Initech Managed Services");
  });
});
