import { z } from "zod";
import { getRepo } from "@/server/repo-factory";


const Body = z
  .object({
    priceTolPct: z.number().min(0).max(0.25),
    priceTolAbsCents: z.number().int().min(0).max(100_000),
    poOverrunPct: z.number().min(0).max(0.25),
    freightCapCents: z.number().int().min(0).max(100_000),
    approvalThresholdCents: z.number().int().min(100).max(100_000_000),
    dupRejectScore: z.number().min(0).max(1),
    dupHoldScore: z.number().min(0).max(1),
    dupWindowDays: z.number().int().min(1).max(365),
    quoteMinSimilarity: z.number().min(0.5).max(1),
    maxTaxRate: z.number().min(0).max(0.5),
  })
  .refine((p) => p.dupHoldScore < p.dupRejectScore, { message: "Hold score must be below reject score" });

export async function GET() {
  return Response.json(await (await getRepo()).getPolicy());
}

/** Save a new AOP version (exception owners are kept from the current version). */
export async function PUT(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  const repo = await getRepo();
  const current = await repo.getPolicy();
  return Response.json(await repo.savePolicy({ ...parsed.data, owners: current.owners }, "reviewer"));
}
