import { getRepo } from "@/server/repo-factory";


export async function GET() {
  const repo = await getRepo();
  const [data, policy] = await Promise.all([repo.listMasterData(), repo.getPolicy()]);
  return Response.json({ ...data, policy });
}
