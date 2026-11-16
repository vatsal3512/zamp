import { after } from "next/server";
import type { InboxEnvelope, RunEvent } from "@/domain/types";
import { runPipeline } from "@/pipeline/run-pipeline";
import { encodeSse } from "./sse";
import { getExtractor, getRepo } from "./repo-factory";
import { COMPANY } from "../../fixtures/seed-data";

export interface StartRunBody { inboxMessageId?: string; documentId?: string; rerunOf?: string; fresh?: boolean }

/**
 * Starts a pipeline run and streams its events as SSE. The pipeline runs detached from the stream:
 * if the viewer leaves, the run still finishes and is persisted (after() keeps the function alive).
 */
export async function startRunStream(body: StartRunBody): Promise<Response> {
  const repo = await getRepo();
  const inbox = await repo.listInbox();
  let documentId: string | undefined;
  let envelope: InboxEnvelope | null = null;
  let source: "inbox" | "upload" | "rerun" = "upload";

  if (body.inboxMessageId) {
    const m = inbox.find((x) => x.id === body.inboxMessageId);
    if (!m) return Response.json({ error: "Inbox message not found" }, { status: 404 });
    documentId = m.documentId;
    envelope = { from: m.from, subject: m.subject, body: m.body, receivedAt: m.receivedAt };
    source = "inbox";
  } else if (body.rerunOf) {
    const prev = await repo.getRun(body.rerunOf);
    if (!prev) return Response.json({ error: "Run not found" }, { status: 404 });
    documentId = prev.documentId;
    const m = inbox.find((x) => x.documentId === prev.documentId);
    if (m) envelope = { from: m.from, subject: m.subject, body: m.body, receivedAt: m.receivedAt };
    source = "rerun";
  } else documentId = body.documentId;

  const doc = documentId ? await repo.getDocument(documentId) : null;
  if (!doc) return Response.json({ error: "Document not found" }, { status: 404 });

  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start: (c) => void (controller = c),
    cancel: () => void (open = false),
  });
  const write = (e: RunEvent) => {
    if (!open) return;
    try {
      controller.enqueue(encoder.encode(encodeSse(e)));
    } catch {
      open = false;
    }
  };

  const run = runPipeline(
    { documentId: doc.id, pdf: doc.bytes, envelope, source, rerunOf: body.rerunOf, fresh: body.fresh },
    { repo, extractor: await getExtractor(repo), emit: write, company: COMPANY },
  )
    .catch((e) => console.error("pipeline crashed", e))
    .finally(() => {
      if (open) {
        open = false;
        try { controller.close(); } catch { /* already closed */ }
      }
    });
  try {
    after(() => run);
  } catch {
    /* outside a Next request scope (tests) — the promise still completes */
  }

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
