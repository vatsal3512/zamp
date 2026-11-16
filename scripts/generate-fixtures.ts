/**
 * Generates fixtures/pdfs/* from fixtures/invoice-docs.ts — run with: npx tsx scripts/generate-fixtures.ts
 * Digital → Chromium print-to-PDF (text layer). Scanned → screenshot → sharp (rotate, noise, blur) → image-only PDF.
 */
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "0"; // browsers live in node_modules (D:), not the user profile

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { INVOICE_DOCS } from "../fixtures/invoice-docs";
import { SCENARIOS } from "../fixtures/scenarios";
import { renderDoc } from "../fixtures/templates/render";

const OUT = path.resolve("fixtures/pdfs");
const GUIDE_SRC = path.resolve("ASA Case Study — Candidate Guide.pdf");
const LETTER = { width: 816, height: 1056 }; // CSS px at 96 dpi
const SCALE = 150 / 96; // 150 dpi screenshots

async function degrade(png: Buffer, angle: number, heavy: boolean): Promise<Buffer> {
  const img = sharp(png);
  const { width = 0, height = 0 } = await img.metadata();
  const noise = await sharp({ create: { width, height, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: heavy ? 28 : 14 } } })
    .png().toBuffer();
  return sharp(png)
    .composite([{ input: noise, blend: "soft-light" }])
    .rotate(angle, { background: "#f4f2ec" })
    .grayscale()
    .blur(heavy ? 0.6 : 0.4)
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function imagePdf(jpeg: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpeg);
  const page = doc.addPage([612, 792]);
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  return doc.save();
}

async function main() {
  const { chromium } = await import("playwright");
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: LETTER, deviceScaleFactor: SCALE });

  for (const s of SCENARIOS) {
    const out = path.join(OUT, s.file);
    if (s.id === "guide") {
      copyFileSync(GUIDE_SRC, out);
      console.log(`copied  ${s.file}`);
      continue;
    }
    const doc = INVOICE_DOCS.find((d) => d.scenarioId === s.id);
    if (!doc) throw new Error(`No invoice doc for scenario ${s.id}`);
    await page.setContent(renderDoc(doc), { waitUntil: "load" });

    if (s.kind === "digital") {
      writeFileSync(out, await page.pdf({ format: "Letter", printBackground: true }));
    } else {
      const shot = await page.screenshot({ fullPage: false, type: "png" });
      writeFileSync(out, await imagePdf(await degrade(shot, 1.5, true)));
    }
    console.log(`wrote   ${s.file}`);

    if (s.id === "happy") {
      const shot = await page.screenshot({ fullPage: false, type: "png" });
      writeFileSync(path.join(OUT, "acme-AC-5531-photo.jpg"), await degrade(shot, 3, false));
      console.log("wrote   acme-AC-5531-photo.jpg");
    }
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
