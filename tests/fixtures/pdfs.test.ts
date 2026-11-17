import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { SCENARIOS } from "../../fixtures/scenarios";

const dir = path.resolve(__dirname, "../../fixtures/pdfs");

// What each digital PDF must visibly contain (invoice number when there is one).
const marker = (id: string, invoiceNumber: string | null) =>
  ({ stmt: "STATEMENT", notice: "holiday closure", missing: "Soylent" } as Record<string, string>)[id] ?? invoiceNumber!;

async function textOf(file: string) {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path.join(dir, file))));
  const { text } = await extractText(pdf, { mergePages: true });
  return text as string;
}

describe("fixture PDFs", () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))("%s exists", (_id, s) => {
    expect(existsSync(path.join(dir, s.file))).toBe(true);
  });

  it.each(SCENARIOS.filter((s) => s.kind === "digital").map((s) => [s.id, s] as const))(
    "%s has a text layer with its identifying text",
    async (_id, s) => {
      expect(await textOf(s.file)).toContain(marker(s.id, s.truth.invoiceNumber));
    },
  );

  it.each(SCENARIOS.filter((s) => s.kind === "scanned").map((s) => [s.id, s] as const))(
    "%s is image-only (no text layer)",
    async (_id, s) => {
      expect((await textOf(s.file)).replace(/\s/g, "").length).toBeLessThan(20);
    },
  );

  it("ec5 prints the wrong total and missing omits number and date", async () => {
    expect(await textOf("soylent-SC-2219.pdf")).toContain("7,430.00");
    const missing = await textOf("soylent-nofields.pdf");
    expect(missing).not.toMatch(/Invoice\s*(No|#|number)/i);
    expect(missing).not.toMatch(/Invoice date/i);
  });

  it("emits the phone-photo JPG for the upload test", () => {
    expect(existsSync(path.join(dir, "acme-AC-5531-photo.jpg"))).toBe(true);
  });
});
