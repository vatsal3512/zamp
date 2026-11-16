/**
 * Records real pipeline runs (fixture extractions, in-memory repo) into fixtures/mock-runs.json.
 * The UI mock and UI development use these, so screens show genuine events and decisions.
 *   npx tsx scripts/record-mock-runs.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { MemoryRepo } from "../src/db/memory-repo";
import { runPipeline } from "../src/pipeline/run-pipeline";
import { computeKpis } from "../src/server/kpis";
import { SCENARIOS } from "../fixtures/scenarios";
import { COMPANY } from "../fixtures/seed-data";
import { extractionFor } from "../fixtures/doc-to-extraction";

const ORDER = ["happy", "ec1", "ec2", "ec3a", "ec3b", "ec4", "ec5", "pv"];

async function main() {
  const repo = new MemoryRepo();
  const bySha = new Map(SCENARIOS.map((s) => [createHash("sha256").update(readFileSync(`fixtures/pdfs/${s.file}`)).digest("hex"), s.id]));
  const extractor = {
    extract: async (_pdf: Uint8Array, sha: string) => ({ invoice: extractionFor(bySha.get(sha)!), model: "gemini-3.6-flash", cached: false, attempts: [] }),
  };
  const ids: Record<string, string> = {};
  for (const id of ORDER) {
    const s = SCENARIOS.find((x) => x.id === id)!;
    const doc = (await repo.getDocument(`doc-${id}`))!;
    const r = await runPipeline({ documentId: doc.id, pdf: doc.bytes, envelope: s.envelope, source: "inbox" }, { repo, extractor, emit: () => {}, company: COMPANY });
    ids[id] = r.runId;
  }
  const runs = await repo.listRuns();
  const details = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([sid, rid]) => [sid, await repo.getRun(rid)])));
  writeFileSync("fixtures/mock-runs.json", JSON.stringify({ runs, kpis: computeKpis(runs), details, inbox: await repo.listInbox() }, null, 1));
  console.log(`recorded ${runs.length} runs`);
}
main();
