import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runPipeline } from "@/pipeline/run-pipeline";
import { MemoryRepo } from "@/db/memory-repo";
import { buildView } from "@/components/run/use-run";
import { narrate } from "@/templates/narrate";
import type { RunEvent } from "@/domain/types";
import { SCENARIOS } from "../fixtures/scenarios";
import { COMPANY } from "../fixtures/seed-data";
import { extractionFor } from "../fixtures/doc-to-extraction";

async function storyFor(id: string): Promise<string> {
  const s = SCENARIOS.find((x) => x.id === id)!;
  const events: RunEvent[] = [];
  await runPipeline({ documentId: s.id, pdf: new Uint8Array(readFileSync(`fixtures/pdfs/${s.file}`)), envelope: s.envelope, source: "inbox" }, {
    repo: new MemoryRepo(), company: COMPANY, emit: (e) => events.push(e),
    extractor: { extract: async () => ({ invoice: extractionFor(s.id), model: "fixture", cached: true, attempts: [] }) },
  });
  const v = buildView(events);
  const inv = v.invoice;
  return narrate(v.decision!, {
    vendorName: v.vendor?.legalName ?? inv?.vendorName.value ?? null, invoiceNumber: inv?.invoiceNumber.value ?? null,
    totalCents: inv?.total.value != null ? Math.round(inv.total.value * 100) : null, currency: inv?.currency.value ?? null,
    poNumber: v.po?.poNumber ?? null, received: v.grns.length > 0,
  });
}

describe("narrate — the plain-English story", () => {
  it.each(SCENARIOS.map((s) => [s.id]))("%s reads as clean prose", async (id) => {
    const t = await storyFor(id);
    expect(t.length).toBeGreaterThan(60);
    expect(t).not.toMatch(/\.\.(?!\.)|\s{2,}|'s's|s's |\ba other\b|undefined|null|NaN|—\s*$/);
  });

  it("tells the touchless story for the happy path", async () => {
    expect(await storyFor("happy")).toBe(
      "Invoice AC-5531 from Acme Office Supplies, LLC for $1,255.59 matches purchase order PO-2031, the goods are recorded as received, and the prices agree. It isn't a duplicate and the vendor's details match our records, so it was approved and posted to the ledger without anyone touching it.",
    );
  });

  it("explains EC-4 as fraud that looks right on the surface", async () => {
    const t = await storyFor("ec4");
    expect(t).toContain("looks right on the surface — the amounts match purchase order PO-2064");
    expect(t).toContain("2 classic signs of invoice fraud");
    expect(t).toContain("Payment is blocked, and Treasury has been asked");
  });

  it("explains the inferred PO, the duplicate and the non-invoice", async () => {
    expect(await storyFor("ec2")).toContain("(found from the line items, since none was printed)");
    expect(await storyFor("ec3a")).toContain("can't be paid twice");
    expect(await storyFor("notice")).toContain("is a letter or other document, not an invoice");
    expect(await storyFor("credit")).toContain("isn't a bill to pay");
  });
});
