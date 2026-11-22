/**
 * URL that starts a new live run. Every call carries a fresh `t` token: Next keeps visited pages alive, so the
 * live-run page must see a new query to know it should start a new run instead of showing the last one.
 * `fresh` asks for a live model read instead of the recorded one.
 */
export function liveRunHref(start: { inbox?: string; document?: string; rerunOf?: string; fresh?: boolean }): string {
  const q = new URLSearchParams();
  if (start.inbox) q.set("inbox", start.inbox);
  if (start.document) q.set("document", start.document);
  if (start.rerunOf) q.set("rerunOf", start.rerunOf);
  if (start.fresh) q.set("fresh", "1");
  q.set("t", Math.random().toString(36).slice(2, 10));
  return `/runs/live?${q}`;
}

export interface LiveRunBody { inboxMessageId?: string; documentId?: string; rerunOf?: string; fresh?: boolean }

/** The run a live-run URL asks for, or null when the query starts nothing (e.g. after the URL becomes /runs/<id>). */
export function liveRunStart(q: URLSearchParams): { key: string; body: LiveRunBody } | null {
  const body: LiveRunBody = { inboxMessageId: q.get("inbox") ?? undefined, documentId: q.get("document") ?? undefined, rerunOf: q.get("rerunOf") ?? undefined };
  if (!body.inboxMessageId && !body.documentId && !body.rerunOf) return null;
  if (q.get("fresh") === "1") body.fresh = true;
  return { key: q.toString(), body };
}
