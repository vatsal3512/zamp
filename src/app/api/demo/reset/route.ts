import { resetDemo } from "@/server/repo-factory";


export async function POST() {
  await resetDemo();
  return Response.json({ ok: true });
}
