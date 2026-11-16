/**
 * Eval: runs every scenario end-to-end through the real pipeline.
 *   npx tsx scripts/eval.ts           → uses cached extractions in fixtures/extractions (no API calls on a hit)
 *   npx tsx scripts/eval.ts --fresh   → re-extracts every PDF with Gemini and refreshes the cache
 */
import { existsSync } from "node:fs";
import { GeminiExtractor } from "../src/ai/gemini-extractor";
import { CachedExtractor, fileCacheStore } from "../src/ai/cached-extractor";
import { runEval } from "../src/pipeline/eval";
import type { ExtractOptions } from "../src/pipeline/ports";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const fresh = process.argv.includes("--fresh");
const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

async function main() {
  const gemini = new GeminiExtractor({
    keys: list(process.env.GEMINI_API_KEYS),
    models: list(process.env.GEMINI_MODELS),
    withBoxes: process.env.EXTRACT_BOXES === "true",
  });
  const cached = new CachedExtractor(gemini, fileCacheStore());
  const extractor = { extract: (pdf: Uint8Array, sha: string, o?: ExtractOptions) => cached.extract(pdf, sha, { ...o, fresh: fresh || o?.fresh }) };

  const results = await runEval({ extractor });
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${pad("scenario", 22)}${pad("expected", 20)}${pad("actual", 20)}rules`);
  for (const r of results) {
    console.log(`${pad(`${r.pass ? "✓" : "✗"} ${r.tag}`, 22)}${pad(r.expected, 20)}${pad(r.actual, 20)}${r.rules.join(" ") || "—"}`);
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} scenarios correct`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
