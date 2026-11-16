import { getCacheOnlyExtractor, getRepo } from "@/server/repo-factory";
import { runEval } from "@/pipeline/eval";

export const maxDuration = 120;

/** Runs all scenarios on recorded extractions only (never spends API quota). */
export async function GET() {
  const repo = await getRepo();
  const results = await runEval({
    extractor: getCacheOnlyExtractor(repo),
    loadPdf: async (s) => (await repo.getDocument(`doc-${s.id}`))!.bytes,
  });
  return Response.json({ passed: results.filter((r) => r.pass).length, total: results.length, results });
}
