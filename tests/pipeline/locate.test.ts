import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { locate, placeBoxes, type PlacedText } from "@/pipeline/locate";
import { inspect } from "@/pipeline/stages/inspect";
import { SCENARIOS } from "../../fixtures/scenarios";
import { extractionFor } from "../../fixtures/doc-to-extraction";

const t = (str: string, x0: number, y0: number, w = 60): PlacedText => ({ str, x0, y0, x1: x0 + w, y1: y0 + 12 });

describe("locate", () => {
  const page = [t("Subtotal", 600, 700), t("$1,255.59", 800, 700), t("Total due", 600, 740), t("$1,255.59", 800, 740)];

  it("uses the quote to pick the right line, then tightens the box to the value", () => {
    const b = locate("Total due $1,255.59", 1255.59, page)!;
    expect(b[0]).toBeGreaterThan(730); // the total line, not the subtotal line
    expect(b[1]).toBeGreaterThan(790); // just the amount, not the label
  });

  it("boxes a quote split across labelled lines (routing + account)", () => {
    const bank = [t("Routing (ABA): 021000021", 100, 800, 150), t("Account: 4417730001", 100, 815, 130)];
    const b = locate("021000021\n4417730001", "021000021-4417730001", bank)!;
    expect(b[0]).toBeLessThan(800);
    expect(b[2]).toBeGreaterThan(827);
  });

  it("refuses to join pieces that are far apart on the page", () => {
    const far = [t("021000021", 100, 100), t("4417730001", 100, 900)];
    expect(locate("021000021\n4417730001", null, far)).toBeUndefined();
  });

  it("returns nothing when the quote isn't on the page", () => {
    expect(locate("Amount payable $9.99", 9.99, page)).toBeUndefined();
  });
});

describe("placeBoxes", () => {
  it("places the invoice number and total on every digital fixture, on the printed text", async () => {
    for (const s of SCENARIOS.filter((x) => x.kind === "digital")) {
      const ins = await inspect(new Uint8Array(readFileSync(`fixtures/pdfs/${s.file}`)));
      const x = placeBoxes(extractionFor(s.id as never), ins.data.pageItems, ins.data.kind);
      for (const k of ["invoiceNumber", "total"] as const) {
        if (x[k].value == null) continue;
        const b = x[k].box;
        expect(b, `${s.id} ${k}`).toBeDefined();
        const inside = ins.data.pageItems[(x[k].page ?? 1) - 1].filter((i) => i.x0 >= b![1] && i.x1 <= b![3] && i.y0 >= b![0] && i.y1 <= b![2]);
        expect(inside.map((i) => i.str).join(" "), `${s.id} ${k}`).toContain(String(x[k].quote).split(" ").pop());
      }
    }
  });

  it("drops an unconfirmed model box on a digital PDF and keeps model boxes on scans", () => {
    const x = extractionFor("happy");
    x.total = { ...x.total, quote: "nowhere", box: [1, 1, 2, 2] };
    expect(placeBoxes(x, [[t("hello", 0, 0)]], "digital").total.box).toBeUndefined();
    expect(placeBoxes(x, [], "scanned").total.box).toEqual([1, 1, 2, 2]);
  });
});
