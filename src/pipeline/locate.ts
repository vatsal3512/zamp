import { normalizeForQuote } from "@/domain/text";
import type { Box, ExtractedInvoice } from "@/domain/types";

/** A text item from the PDF text layer, in page space normalised to 0–1000 with a top-left origin. */
export interface PlacedText { str: string; y0: number; x0: number; y1: number; x1: number }

const HEADER_FIELDS = [
  "invoiceNumber", "invoiceDate", "dueDate", "vendorName", "vendorTaxId", "billTo", "poNumber",
  "currency", "servicePeriod", "subtotal", "taxTotal", "total", "bankAccount",
] as const;

/** Items on (roughly) the same baseline, left to right. */
function lines(items: PlacedText[]): PlacedText[][] {
  const sorted = items.filter((i) => normalizeForQuote(i.str)).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out: PlacedText[][] = [];
  for (const it of sorted) {
    const mid = (it.y0 + it.y1) / 2;
    const line = out.find((l) => Math.abs((l[0].y0 + l[0].y1) / 2 - mid) <= Math.max(4, (l[0].y1 - l[0].y0) / 2));
    if (line) line.push(it);
    else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.x0 - b.x0));
}

/** Normalised text of a run of items, with each item's [start, end) offset into it. */
function indexed(items: PlacedText[]) {
  let text = "";
  const spans = items.map((it) => {
    const start = text.length;
    text += normalizeForQuote(it.str);
    return { it, start, end: text.length };
  });
  return { text, spans };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function union(items: PlacedText[]): Box {
  const pad = 3;
  return [
    r1(Math.max(0, Math.min(...items.map((i) => i.y0)) - pad)),
    r1(Math.max(0, Math.min(...items.map((i) => i.x0)) - pad)),
    r1(Math.min(1000, Math.max(...items.map((i) => i.y1)) + pad)),
    r1(Math.min(1000, Math.max(...items.map((i) => i.x1)) + pad)),
  ];
}

/**
 * Find where a quoted value sits on the page. The quote picks the line (so "Total due $1,255.59" beats a
 * subtotal that prints the same digits); within it the box tightens to the value itself when it can.
 */
export function locate(quote: string | null, value: unknown, items: PlacedText[]): Box | undefined {
  const v = value == null ? "" : normalizeForQuote(typeof value === "number" ? value.toFixed(2) : String(value));
  const ls = lines(items);
  // A quote usually sits on one line; allow it to run over into the next line (wrapped addresses, IBANs).
  const adjacent = (a: PlacedText[], b: PlacedText[]) => b[0].y0 - a[0].y1 <= 2 * (a[0].y1 - a[0].y0);
  const runs = [...ls, ...ls.slice(0, -1).flatMap((l, i) => (adjacent(l, ls[i + 1]) ? [[...l, ...ls[i + 1]]] : []))];

  const find = (target: string, tighten: string): PlacedText[] | undefined => {
    if (!target) return undefined;
    for (const run of runs) {
      const { text, spans } = indexed(run);
      const at = text.indexOf(target);
      if (at < 0) continue;
      let from = at, to = at + target.length;
      const inner = tighten && tighten !== target ? text.slice(from, to).indexOf(tighten) : -1;
      if (inner >= 0) { from += inner; to = from + tighten.length; }
      const hit = spans.filter((s) => s.start < to && s.end > from).map((s) => s.it);
      if (hit.length) return hit;
    }
    return undefined;
  };

  const whole = find(normalizeForQuote(quote ?? "") || v, v);
  if (whole) return union(whole);

  // Quotes split by labels ("021000021\nAccount: 4417730001", or a value printed as routing + account on
  // two lines): find every piece, and box them together only if each one is on the page.
  const pieces = (quote?.includes("\n") ? quote.split("\n") : String(value ?? "").split(/[-\s]+/))
    .map(normalizeForQuote).filter((p) => p.length >= 4);
  if (pieces.length < 2) return undefined;
  const found = pieces.map((p) => find(p, ""));
  if (!found.every(Boolean)) return undefined;
  const box = union(found.flatMap((f) => f!));
  return box[2] - box[0] <= 80 ? box : undefined; // pieces must sit together, not across the page
}

/**
 * Place each header field's box from the PDF text layer. On a digital PDF the text layer is the truth, so a
 * model-supplied box that can't be confirmed is dropped. On a scan there is no text layer; any model box is kept.
 */
export function placeBoxes(x: ExtractedInvoice, pageItems: PlacedText[][], kind: "digital" | "scanned"): ExtractedInvoice {
  if (kind !== "digital" || !pageItems.length) return x;
  const out = { ...x };
  for (const k of HEADER_FIELDS) {
    const f = x[k];
    const page = f.page && pageItems[f.page - 1] ? f.page : null;
    const pages = page ? [page] : pageItems.map((_, i) => i + 1);
    let box: Box | undefined;
    let found = page;
    for (const p of pages) {
      box = f.value == null ? undefined : locate(f.quote, f.value, pageItems[p - 1]);
      if (box) { found = p; break; }
    }
    (out as Record<string, unknown>)[k] = box ? { ...f, box, page: found } : { ...f, box: undefined };
  }
  return out;
}
