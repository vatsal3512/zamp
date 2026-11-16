import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inspect } from "@/pipeline/stages/inspect";

const pdf = (f: string) => new Uint8Array(readFileSync(path.resolve(__dirname, "../../fixtures/pdfs", f)));

describe("inspect", () => {
  it("classifies a generated PDF as digital and hashes it", async () => {
    const r = await inspect(pdf("acme-AC-5531.pdf"));
    expect(r.data.kind).toBe("digital");
    expect(r.data.pages).toBe(1);
    expect(r.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.data.pageTexts[0]).toContain("AC-5531");
    expect(r.hits).toEqual([]);
  });

  it("classifies an image-only PDF as scanned", async () => {
    expect((await inspect(pdf("stark-SIP-7781-scan.pdf"))).data.kind).toBe("scanned");
  });

  it("holds an unreadable file under R-DOC-04 instead of throwing", async () => {
    const r = await inspect(new Uint8Array([1, 2, 3]));
    expect(r.halt).toBe(true);
    expect(r.hits[0].rule).toBe("R-DOC-04");
    expect(r.hits[0].outcome).toBe("HOLD");
  });
});
