import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Outcome, RuleId } from "@/domain/types";
import type { Extractor } from "./ports";
import { runPipeline } from "./run-pipeline";
import { MemoryRepo } from "@/db/memory-repo";
import { SCENARIOS, type Scenario } from "../../fixtures/scenarios";
import { COMPANY } from "../../fixtures/seed-data";

export interface EvalResult { id: string; tag: string; expected: Outcome; actual: Outcome | "FAILED"; rules: RuleId[]; rulesOk: boolean; pass: boolean }

/** Runs one scenario end-to-end against a fresh in-memory procurement system. */
export async function runScenario(s: Scenario, extractor: Extractor, pdfDir = "fixtures/pdfs"): Promise<EvalResult> {
  const pdf = new Uint8Array(await readFile(path.resolve(process.cwd(), pdfDir, s.file)));
  const r = await runPipeline({ documentId: s.id, pdf, envelope: s.envelope, source: "inbox" }, { repo: new MemoryRepo(), extractor, emit: () => {}, company: COMPANY });
  const actual = r.failed || !r.decision ? "FAILED" : r.decision.outcome;
  const rules = r.decision?.hits.map((h) => h.rule) ?? [];
  const rulesOk = s.expected.rules.every((x) => rules.includes(x));
  return { id: s.id, tag: s.tag, expected: s.expected.outcome, actual, rules, rulesOk, pass: actual === s.expected.outcome && rulesOk };
}

export async function runEval(opts: { extractor: Extractor; pdfDir?: string }): Promise<EvalResult[]> {
  const out: EvalResult[] = [];
  for (const s of SCENARIOS) out.push(await runScenario(s, opts.extractor, opts.pdfDir));
  return out;
}
