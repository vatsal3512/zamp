/**
 * Lenient extraction schema: every key required, every value nullable, no sign/range constraints.
 * Meaning (missing fields, negative amounts, odd tax) is judged in the Validate stage, never here.
 */
import { z } from "zod";
import { DOCUMENT_TYPES, type ExtractedInvoice } from "@/domain/types";

const LINE_TYPES = ["goods", "service", "freight", "tax", "discount", "other"] as const;
const box = z.tuple([z.number(), z.number(), z.number(), z.number()]).optional();

const field = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value: value.nullable(), quote: z.string().nullable(), page: z.number().nullable(), confidence: z.number(), box });

export const extractionZod = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  documentTypeReason: z.string().nullable(),
  invoiceNumber: field(z.string()), invoiceDate: field(z.string()), dueDate: field(z.string()),
  vendorName: field(z.string()), vendorTaxId: field(z.string()), billTo: field(z.string()),
  poNumber: field(z.string()), currency: field(z.string()), servicePeriod: field(z.string()),
  taxInclusive: z.boolean().nullable(),
  lines: z.array(z.object({
    description: z.string().nullable(), lineType: z.enum(LINE_TYPES).nullable(),
    quantity: z.number().nullable(), unitPrice: z.number().nullable(), amount: z.number().nullable(),
    quote: z.string().nullable(), page: z.number().nullable(), confidence: z.number(), box,
  })),
  subtotal: field(z.number()), taxTotal: field(z.number()), total: field(z.number()),
  bankAccount: field(z.string()),
});

// ---- JSON schema sent to Gemini (hand-built so nullables use type arrays, the form the smoke test proves) ----
type JS = Record<string, unknown>;
const nullable = (type: string): JS => ({ type: [type, "null"] });
const obj = (properties: Record<string, JS>): JS => ({ type: "object", properties, required: Object.keys(properties) });
const boxSchema: JS = { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4, description: "[ymin,xmin,ymax,xmax] normalised 0-1000" };

const fieldSchema = (type: string, withBoxes: boolean): JS =>
  obj({
    value: nullable(type), quote: nullable("string"), page: nullable("integer"), confidence: { type: "number" },
    ...(withBoxes ? { box: { ...boxSchema, type: ["array", "null"] } } : {}),
  });

export function extractionJsonSchema(withBoxes: boolean): JS {
  const fs = (t: string) => fieldSchema(t, withBoxes);
  return obj({
    documentType: { type: "string", enum: [...DOCUMENT_TYPES] },
    documentTypeReason: nullable("string"),
    invoiceNumber: fs("string"), invoiceDate: fs("string"), dueDate: fs("string"),
    vendorName: fs("string"), vendorTaxId: fs("string"), billTo: fs("string"),
    poNumber: fs("string"), currency: fs("string"), servicePeriod: fs("string"),
    taxInclusive: nullable("boolean"),
    lines: {
      type: "array",
      items: obj({
        description: nullable("string"), lineType: { type: ["string", "null"], enum: [...LINE_TYPES, null] },
        quantity: nullable("number"), unitPrice: nullable("number"), amount: nullable("number"),
        quote: nullable("string"), page: nullable("integer"), confidence: { type: "number" },
        ...(withBoxes ? { box: { ...boxSchema, type: ["array", "null"] } } : {}),
      }),
    },
    subtotal: fs("number"), taxTotal: fs("number"), total: fs("number"),
    bankAccount: fs("string"),
  });
}

// ---- tolerant parsing ----
const NUMERIC_KEYS = new Set(["quantity", "unitPrice", "amount", "confidence", "page"]);
const NUMERIC_FIELDS = new Set(["subtotal", "taxTotal", "total"]);

function toNumber(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  const negative = /^\(.*\)$/.test(s) || /^[-−]/.test(s);
  const cleaned = s.replace(/[()$₹€£,\s−-]/g, "").replace(/^[A-Z]{3}/, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return v;
  const n = Number(cleaned);
  return negative ? -n : n;
}

/** Turn numeric-looking strings ("1,234.56", "$45.00", "(12.00)") into numbers — only for numeric keys. */
export function coerceNumbers(obj: unknown, parentKey?: string): unknown {
  if (Array.isArray(obj)) return obj.map((x) => coerceNumbers(x, parentKey));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const numeric = NUMERIC_KEYS.has(k) || (k === "value" && parentKey !== undefined && NUMERIC_FIELDS.has(parentKey));
      out[k] = numeric ? toNumber(v) : coerceNumbers(v, k);
    }
    return out;
  }
  return obj;
}

export function parseExtraction(raw: string): { ok: true; value: ExtractedInvoice } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Response was not valid JSON" };
  }
  const r = extractionZod.safeParse(coerceNumbers(json));
  if (!r.success) return { ok: false, error: r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, value: r.data as ExtractedInvoice };
}
