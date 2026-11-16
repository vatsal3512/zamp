import { createHash } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import type { StageResult } from "@/domain/types";

export interface InspectData { sha256: string; pages: number; kind: "digital" | "scanned"; pageTexts: string[] }

const MIN_CHARS_PER_PAGE = 20;

export async function inspect(pdf: Uint8Array): Promise<StageResult<InspectData>> {
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  try {
    const doc = await getDocumentProxy(new Uint8Array(pdf)); // copy: pdf.js may detach the buffer
    const { totalPages, text } = await extractText(doc, { mergePages: false });
    const pageTexts = text as string[];
    const chars = pageTexts.reduce((s, t) => s + t.replace(/\s/g, "").length, 0);
    const kind = totalPages > 0 && chars / totalPages >= MIN_CHARS_PER_PAGE ? "digital" : "scanned";
    return {
      hits: [],
      findings: [{ level: "ok", text: `${totalPages} page${totalPages === 1 ? "" : "s"} · ${kind === "digital" ? "digital PDF (text layer)" : "scanned / image-only PDF"}` }],
      data: { sha256, pages: totalPages, kind, pageTexts },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return {
      hits: [{ rule: "R-DOC-04", outcome: "HOLD", facts: { error } }],
      findings: [{ level: "error", text: `Couldn't read this file as a PDF: ${error}` }],
      data: { sha256, pages: 0, kind: "scanned", pageTexts: [] },
      halt: true,
    };
  }
}
