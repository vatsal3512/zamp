import { createHash } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";
import type { StageResult } from "@/domain/types";
import type { PlacedText } from "../locate";

export interface InspectData { sha256: string; pages: number; kind: "digital" | "scanned"; pageTexts: string[]; pageItems: PlacedText[][] }

const MIN_CHARS_PER_PAGE = 20;
const MAX_PLACED_PAGES = 20;

type Doc = Awaited<ReturnType<typeof getDocumentProxy>>;
type RawItem = { str?: string; transform?: number[]; width?: number; height?: number };

/** Every text item with its box in page space normalised to 0–1000 (top-left origin), for placing highlights. */
async function placedText(doc: Doc, pages: number): Promise<PlacedText[][]> {
  const out: PlacedText[][] = [];
  for (let n = 1; n <= pages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items as RawItem[];
    out.push(items.flatMap((i) => {
      if (!i.str?.trim() || !i.transform) return [];
      const [, , , d, e, f] = i.transform;
      const h = i.height || Math.abs(d) || 10;
      const w = i.width ?? 0;
      const [ax, ay] = vp.convertToViewportPoint(e, f + h * 0.85);
      const [bx, by] = vp.convertToViewportPoint(e + w, f - h * 0.25);
      return [{
        str: i.str,
        x0: (Math.min(ax, bx) / vp.width) * 1000, x1: (Math.max(ax, bx) / vp.width) * 1000,
        y0: (Math.min(ay, by) / vp.height) * 1000, y1: (Math.max(ay, by) / vp.height) * 1000,
      }];
    }));
  }
  return out;
}

export async function inspect(pdf: Uint8Array): Promise<StageResult<InspectData>> {
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  try {
    const doc = await getDocumentProxy(new Uint8Array(pdf)); // copy: pdf.js may detach the buffer
    const { totalPages, text } = await extractText(doc, { mergePages: false });
    const pageTexts = text as string[];
    const chars = pageTexts.reduce((s, t) => s + t.replace(/\s/g, "").length, 0);
    const kind = totalPages > 0 && chars / totalPages >= MIN_CHARS_PER_PAGE ? "digital" : "scanned";
    const pageItems = kind === "digital" ? await placedText(doc, Math.min(totalPages, MAX_PLACED_PAGES)).catch(() => []) : []; // highlights are optional
    return {
      hits: [],
      findings: [{ level: "ok", text: `${totalPages} page${totalPages === 1 ? "" : "s"} · ${kind === "digital" ? "digital PDF (text layer)" : "scanned / image-only PDF"}` }],
      data: { sha256, pages: totalPages, kind, pageTexts, pageItems },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return {
      hits: [{ rule: "R-DOC-04", outcome: "HOLD", facts: { error } }],
      findings: [{ level: "error", text: `Couldn't read this file as a PDF: ${error}` }],
      data: { sha256, pages: 0, kind: "scanned", pageTexts: [], pageItems: [] },
      halt: true,
    };
  }
}
