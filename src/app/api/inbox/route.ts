import { getRepo } from "@/server/repo-factory";


export async function GET() {
  return Response.json({ messages: await (await getRepo()).listInbox() });
}
