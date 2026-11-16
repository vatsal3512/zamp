import type { ExtractedInvoice, ExtractedLine, Field, LineType, NetLine } from "@/domain/types";
import { extractionFor } from "../../fixtures/doc-to-extraction";

type Overrides = Partial<Omit<ExtractedInvoice, "lines">> & { lines?: Partial<ExtractedLine>[] };

/** A scenario's perfect extraction (default: happy) with overrides applied. */
export function makeInvoice(overrides: Overrides = {}, scenarioId = "happy"): ExtractedInvoice {
  const base = extractionFor(scenarioId);
  const { lines, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    lines: lines ? lines.map((l) => ({ ...line(), ...l })) : base.lines,
  };
}

export const line = (o: Partial<ExtractedLine> = {}): ExtractedLine => ({
  description: "Item", lineType: "goods", quantity: 1, unitPrice: 10, amount: 10, quote: null, page: 1, confidence: 0.95, ...o,
});

export const fld = <T>(value: T, quote: string | null = null): Field<T> => ({ value, quote, page: 1, confidence: 0.95 });

export function makeNetLines(rows: [description: string, quantity: number, unitCents: number, lineType?: LineType][]): NetLine[] {
  return rows.map(([description, quantity, unitCents, lineType = "goods"], index) => ({
    index, description, lineType, quantity, unitCents, amountCents: quantity * unitCents,
  }));
}
