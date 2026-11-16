/**
 * Model bake-off — npx tsx scripts/bakeoff.ts [--models a,b] [--boxes]
 * Extracts every scenario PDF with each model (one key pool, sequential), scores field accuracy against the
 * scenario truth, records latency, and (with --boxes) measures box hit-rate on digital PDFs. Writes docs/bakeoff-report.md.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { GeminiExtractor } from "../src/ai/gemini-extractor";
import { toCents } from "../src/domain/money";
import { tokenJaccard, normalizeForQuote } from "../src/domain/text";
import { SCENARIOS, type Scenario } from "../fixtures/scenarios";
import type { ExtractedInvoice } from "../src/domain/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`))?.split("=")[1];
const keys = (process.env.GEMINI_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const models = (arg("models") ?? "gemini-3.6-flash,gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite").split(",");
const withBoxes = process.argv.includes("--boxes");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function score(s: Scenario, x: ExtractedInvoice): { correct: number; total: number; misses: string[] } {
  const t = s.truth;
  const checks: [string, boolean][] = [["documentType", x.documentType === t.documentType]];
  if (t.documentType === "invoice" || t.documentType === "credit_note") {
    checks.push(
      ["invoiceNumber", (x.invoiceNumber.value ?? null) === t.invoiceNumber],
      ["total", (x.total.value == null ? null : toCents(x.total.value)) === t.totalCents],
      ["poNumber", (x.poNumber.value ?? null) === t.poNumber],
      ["vendorName", t.vendorName === null ? x.vendorName.value === null : tokenJaccard(x.vendorName.value ?? "", t.vendorName) >= 0.8],
      ["lineCount", x.lines.filter((l) => l.lineType !== "tax").length === t.lineCount],
    );
  }
  const misses = checks.filter(([, ok]) => !ok).map(([k]) => k);
  return { correct: checks.length - misses.length, total: checks.length, misses };
}

/** Box hit: the printed invoice number / total text item centre lies inside the returned box (±15 units). */
async function boxHits(file: string, x: ExtractedInvoice): Promise<{ hit: number; total: number }> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(readFileSync(`fixtures/pdfs/${file}`)));
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const items = (await page.getTextContent()).items as { str: string; transform: number[]; width: number; height: number }[];
  let hit = 0, total = 0;
  for (const f of [x.invoiceNumber, x.total, x.poNumber]) {
    if (!f.box || f.value == null) continue;
    const want = normalizeForQuote(String(f.quote ?? f.value));
    const item = items.find((i) => want && normalizeForQuote(i.str).includes(want.slice(-6)));
    if (!item) continue;
    total++;
    const cx = ((item.transform[4] + item.width / 2) / vp.width) * 1000;
    const cy = ((vp.height - item.transform[5] - item.height / 2) / vp.height) * 1000;
    const [y0, x0, y1, x1] = f.box;
    if (cx >= x0 - 15 && cx <= x1 + 15 && cy >= y0 - 15 && cy <= y1 + 15) hit++;
  }
  return { hit, total };
}

async function main() {
  const out = "docs/bakeoff-report.md";
  const rows: string[] = [];
  for (const model of models) {
    const ex = new GeminiExtractor({ keys, models: [model], withBoxes });
    let correct = 0, total = 0, boxHit = 0, boxTotal = 0, failed = 0;
    const times: number[] = [];
    const misses: string[] = [];
    for (const s of SCENARIOS) {
      const pdf = new Uint8Array(readFileSync(`fixtures/pdfs/${s.file}`));
      const t0 = Date.now();
      try {
        const r = await ex.extract(pdf, s.id);
        times.push(Date.now() - t0);
        const sc = score(s, r.invoice);
        correct += sc.correct;
        total += sc.total;
        if (sc.misses.length) misses.push(`${s.id}: ${sc.misses.join(", ")}`);
        if (withBoxes && s.kind === "digital") {
          const b = await boxHits(s.file, r.invoice);
          boxHit += b.hit;
          boxTotal += b.total;
        }
        process.stdout.write(sc.misses.length ? "x" : ".");
      } catch (e) {
        failed++;
        misses.push(`${s.id}: FAILED ${(e as Error).message.slice(0, 80)}`);
        process.stdout.write("!");
      }
      await sleep(1000);
    }
    const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0;
    const row = `| ${model} | ${withBoxes ? "on" : "off"} | ${((correct / Math.max(1, total)) * 100).toFixed(1)}% (${correct}/${total}) | ${median} ms | ${withBoxes ? `${boxHit}/${boxTotal}` : "—"} | ${failed} |`;
    rows.push(row);
    console.log(`\n${row}\n  misses: ${misses.join(" · ") || "none"}`);
    appendFileSync(".superpowers/bakeoff-raw.log", `${row}\n  misses: ${misses.join(" · ") || "none"}\n`);
  }
  const header = "| model | boxes | field accuracy | median latency | box hits (digital) | failed |\n|---|---|---|---|---|---|";
  const prev = existsSync(out) ? readFileSync(out, "utf8") : "# Model bake-off\n\n";
  writeFileSync(out, `${prev}\n### Run ${new Date().toISOString()} (${withBoxes ? "boxes on" : "boxes off"})\n\n${header}\n${rows.join("\n")}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
