import { getRepo } from "@/server/repo-factory";
import { sniff, wrapImageAsPdf } from "@/server/wrap-image";


const MAX_TOTAL = 12 * 1024 * 1024;
const MAX_CHUNK = 4 * 1024 * 1024;

/**
 * Chunked upload (Vercel caps request bodies at 4.5 MB). Raw body = one chunk; headers:
 * x-upload-id, x-chunk-index, x-chunk-count, x-filename. The final chunk returns { documentId }.
 */
export async function POST(request: Request) {
  const uploadId = request.headers.get("x-upload-id");
  const idx = Number(request.headers.get("x-chunk-index"));
  const count = Number(request.headers.get("x-chunk-count"));
  const filename = request.headers.get("x-filename") ?? "upload";
  if (!uploadId || !Number.isInteger(idx) || !Number.isInteger(count) || idx < 0 || idx >= count) {
    return Response.json({ error: "Missing or invalid upload headers" }, { status: 400 });
  }
  const chunk = new Uint8Array(await request.arrayBuffer());
  if (chunk.length > MAX_CHUNK) return Response.json({ error: "Chunk too large" }, { status: 413 });

  const repo = await getRepo();
  await repo.putUploadChunk(uploadId, idx, chunk);
  if (idx < count - 1) return Response.json({ received: idx });

  const parts = await repo.takeUploadChunks(uploadId);
  if (parts.length !== count) return Response.json({ error: "Upload incomplete — please try again" }, { status: 400 });
  const total = parts.reduce((s, p) => s + p.length, 0);
  if (total > MAX_TOTAL) return Response.json({ error: "File is larger than 12 MB" }, { status: 413 });
  let bytes = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }

  const kind = sniff(bytes);
  if (!kind) return Response.json({ error: "Please upload a PDF, JPG or PNG" }, { status: 400 });
  if (kind !== "pdf") bytes = new Uint8Array(await wrapImageAsPdf(bytes, kind));
  const { documentId } = await repo.saveDocument(bytes, kind === "pdf" ? filename : `${filename}.pdf`);
  return Response.json({ documentId });
}
