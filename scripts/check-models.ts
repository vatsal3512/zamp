/**
 * Model smoke test — run with: npx tsx scripts/check-models.ts
 *
 * Verifies, per allowed Gemini model, that (1) the model ID exists for our keys,
 * (2) PDF input works, and (3) responseJsonSchema with nullable type arrays + enums works.
 * Task 6 must use the same nullable-schema form that passes here.
 * Result form (fill in after running): nullable form = type arrays ["string","null"]
 */
import { GoogleGenAI } from "@google/genai";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const ALLOWED = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const keys = (process.env.GEMINI_API_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);

const schema = {
  type: "object",
  properties: {
    invoiceNumber: { type: "string" },
    total: { type: "number" },
    dueDate: { type: ["string", "null"] },
    documentType: {
      type: "string",
      enum: ["invoice", "credit_note", "statement", "purchase_order", "quote", "receipt", "other"],
    },
  },
  required: ["invoiceNumber", "total", "dueDate", "documentType"],
};

async function tinyPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("INVOICE INV-1 TOTAL 12.34", { x: 40, y: 100, size: 16, font });
  return Buffer.from(await doc.save()).toString("base64");
}

async function main() {
  if (keys.length === 0) {
    console.error("No GEMINI_API_KEYS in .env.local");
    process.exit(1);
  }
  const b64 = await tinyPdf();
  let workingKey: string | null = null;

  for (const [i, key] of keys.entries()) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const found = new Set<string>();
      for await (const m of await ai.models.list()) found.add((m.name ?? "").replace(/^models\//, ""));
      const present = ALLOWED.filter((id) => found.has(id));
      console.log(`key #${i}: ok · allowed models present: ${present.join(", ") || "none"}`);
      workingKey ??= key;
    } catch (e) {
      console.log(`key #${i}: ERROR ${(e as Error).message.slice(0, 120)}`);
    }
  }
  if (!workingKey) process.exit(1);

  const ai = new GoogleGenAI({ apiKey: workingKey });
  console.log("\nmodel | result | ms | parsed");
  for (const model of ALLOWED) {
    const t = Date.now();
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [
          { inlineData: { mimeType: "application/pdf", data: b64 } },
          { text: "Return the invoice number, total, due date and document type." },
        ],
        config: { responseMimeType: "application/json", responseJsonSchema: schema },
      });
      console.log(`${model} | ok | ${Date.now() - t} | ${res.text}`);
    } catch (e) {
      console.log(`${model} | error | ${Date.now() - t} | ${(e as Error).message.slice(0, 160)}`);
    }
  }
}

main();
