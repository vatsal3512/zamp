import { startRunStream, type StartRunBody } from "@/server/run-service";
import { getRepo } from "@/server/repo-factory";
import { computeKpis } from "@/server/kpis";

export const maxDuration = 300;

/** Start a run (inbox message, uploaded document, or re-run) and stream its events as SSE. */
export async function POST(request: Request) {
  let body: StartRunBody;
  try {
    body = (await request.json()) as StartRunBody;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  return startRunStream(body);
}

/** Bills list (optionally only those needing attention) + the KPI ledger strip. */
export async function GET(request: Request) {
  const repo = await getRepo();
  const needsAttention = new URL(request.url).searchParams.get("needsAttention") === "1";
  const all = await repo.listRuns();
  const runs = needsAttention ? await repo.listRuns({ needsAttention: true }) : all;
  return Response.json({ runs, kpis: computeKpis(all) });
}
