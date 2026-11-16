import { describe, expect, it } from "vitest";
import { coerceNumbers, extractionJsonSchema, parseExtraction } from "@/ai/schema";
import { extractionFor } from "../../fixtures/doc-to-extraction";

const happy = () => extractionFor("happy") as unknown as Record<string, any>;
const parse = (o: unknown) => parseExtraction(JSON.stringify(o));

describe("parseExtraction", () => {
  it("parses a complete invoice extraction", () => {
    const r = parse(happy());
    expect(r.ok).toBe(true);
  });

  it("accepts a lump-sum line with no quantity or unit price", () => {
    const x = happy();
    x.lines = [{ ...x.lines[0], quantity: null, unitPrice: null, amount: 3500 }];
    expect(parse(x).ok).toBe(true);
  });

  it("accepts negative discount lines", () => {
    const x = happy();
    x.lines.push({ ...x.lines[0], description: "Loyalty discount", lineType: "discount", quantity: null, unitPrice: null, amount: -25 });
    expect(parse(x).ok).toBe(true);
  });

  it("coerces numbers sent as text", () => {
    const x = happy();
    x.total.value = "1,255.59";
    const r = parse(x);
    expect(r.ok && r.value.total.value).toBe(1255.59);
    expect(coerceNumbers({ amount: "(12.00)" })).toEqual({ amount: -12 });
    expect(coerceNumbers({ amount: "$45.00", description: "12" })).toEqual({ amount: 45, description: "12" });
  });

  it("accepts null values for missing fields", () => {
    const x = happy();
    x.invoiceNumber = { value: null, quote: null, page: null, confidence: 0.1 };
    expect(parse(x).ok).toBe(true);
  });

  it("accepts every document type but rejects unknown ones", () => {
    expect(parse({ ...happy(), documentType: "purchase_order" }).ok).toBe(true);
    expect(parse({ ...happy(), documentType: "banana" }).ok).toBe(false);
  });

  it("rejects text that is not JSON", () => {
    expect(parseExtraction("Sorry, I can't read this").ok).toBe(false);
  });
});

describe("extractionJsonSchema", () => {
  it("requires every key and expresses nullables as type arrays", () => {
    const s = extractionJsonSchema(false) as any;
    expect(s.required).toContain("invoiceNumber");
    expect(s.properties.invoiceNumber.properties.value.type).toEqual(["string", "null"]);
    expect(s.properties.lines.items.properties.box).toBeUndefined();
    expect((extractionJsonSchema(true) as any).properties.lines.items.properties.box).toBeDefined();
  });
});
