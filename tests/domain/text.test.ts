import { describe, expect, it } from "vitest";
import { levenshtein, normalizeForQuote, normalizeInvoiceNumber, quoteFound, similarity, tokenJaccard } from "@/domain/text";

describe("quote verification", () => {
  it("normalises currency symbols, separators and spacing before matching", () => {
    expect(normalizeForQuote("Total: $7,430.00")).toBe("total743000");
    expect(quoteFound("$16,000.00", "Amount due 16 000.00 USD", 0.9).found).toBe(true);
    expect(quoteFound("Total: $7,430.00", "TOTAL 7430.00", 0.9).found).toBe(true);
  });

  it("rejects a quote that is not on the page", () => {
    expect(quoteFound("$9,999.00", "TOTAL 7430.00", 0.9).found).toBe(false);
  });
});

describe("similarity", () => {
  it("computes edit distance and normalised similarity", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(similarity("", "")).toBe(1);
    expect(similarity("INV10422R", "INV10422")).toBeCloseTo(0.889, 2);
    expect(similarity("INV10587", "INV10422")).toBeCloseTo(0.625, 3);
  });

  it("normalises invoice numbers", () => {
    expect(normalizeInvoiceNumber("INV-10422")).toBe("INV10422");
    expect(normalizeInvoiceNumber("inv 10422-r")).toBe("INV10422R");
  });

  it("compares descriptions by word overlap", () => {
    expect(tokenJaccard("Hex bolt M8x40, box of 100", "Hex bolt M8x40 box of 100")).toBe(1);
    expect(tokenJaccard("Desk organizer", "Ergonomic office chair")).toBe(0);
  });
});
