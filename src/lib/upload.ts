export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const CHUNK_BYTES = 3 * 1024 * 1024;
const ACCEPTED = /\.(pdf|jpe?g|png)$/i;

export function checkFile(file: { name: string; size: number }): string | null {
  if (!ACCEPTED.test(file.name)) return "Please upload a PDF, JPG or PNG";
  if (file.size > MAX_UPLOAD_BYTES) return "File is larger than 12 MB";
  if (file.size === 0) return "That file is empty";
  return null;
}

/** Sends the file in 3 MB chunks (Vercel caps request bodies at 4.5 MB). Resolves with the stored document id. */
export async function uploadInChunks(file: File, onProgress?: (fraction: number) => void): Promise<{ documentId: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const count = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  const uploadId = crypto.randomUUID();
  let last: Response | null = null;
  for (let i = 0; i < count; i++) {
    last = await fetch("/api/documents", {
      method: "POST",
      body: bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES),
      headers: { "x-upload-id": uploadId, "x-chunk-index": String(i), "x-chunk-count": String(count), "x-filename": file.name },
    });
    if (!last.ok) throw new Error((await last.json().catch(() => null))?.error ?? `Upload failed (${last.status})`);
    onProgress?.((i + 1) / count);
  }
  return (await last!.json()) as { documentId: string };
}
