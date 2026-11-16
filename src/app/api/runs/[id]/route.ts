import { getRepo } from "@/server/repo-factory";


export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = await getRepo();
  const run = await repo.getRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  const envelope = (await repo.listInbox()).find((m) => m.documentId === run.documentId) ?? null;
  return Response.json({ run, envelope, config: { boxes: process.env.EXTRACT_BOXES === "true" } });
}
