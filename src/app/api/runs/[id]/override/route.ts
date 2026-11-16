import { z } from "zod";
import { getRepo } from "@/server/repo-factory";
import { postAndVerify } from "@/pipeline/run-pipeline";


const Body = z.object({
  action: z.enum(["approve", "sign_off", "reject", "query_sent"]),
  reason: z.string().default(""),
});

/** A person resolves a run: approve (and post), sign off (and post), reject, or mark the vendor query as sent. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid override" }, { status: 400 });
  const { action, reason } = parsed.data;
  if (action !== "sign_off" && reason.trim().length < 5) {
    return Response.json({ error: "Please give a reason (at least 5 characters)" }, { status: 400 });
  }
  const repo = await getRepo();
  const run = await repo.getRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

  let ledger: string | null = null;
  if ((action === "approve" || action === "sign_off") && run.invoiceId && run.poNumber && !run.posted) {
    const matchDone = run.events.find((e) => e.stage === "match" && e.type === "completed");
    const amount = (matchDone?.data as { invoiceSubtotalCents?: number } | undefined)?.invoiceSubtotalCents;
    if (typeof amount === "number") {
      const posted = await postAndVerify(repo, run.poNumber, run.invoiceId, amount);
      if (!posted.ok) return Response.json({ error: posted.text }, { status: 409 });
      ledger = posted.text;
    }
  }
  await repo.recordOverride(id, action, reason.trim() || "Signed off", "reviewer");
  return Response.json({ run: await repo.getRun(id), ledger });
}
