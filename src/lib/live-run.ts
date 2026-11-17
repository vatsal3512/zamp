/**
 * URL that starts a new live run. Every call carries a fresh `t` token: Next keeps visited pages alive, so the
 * live-run page must see a new query to know it should start a new run instead of showing the last one.
 */
export function liveRunHref(start: { inbox?: string; document?: string; rerunOf?: string }): string {
  const q = new URLSearchParams();
  if (start.inbox) q.set("inbox", start.inbox);
  if (start.document) q.set("document", start.document);
  if (start.rerunOf) q.set("rerunOf", start.rerunOf);
  q.set("t", Math.random().toString(36).slice(2, 10));
  return `/runs/live?${q}`;
}

/** The run a live-run URL asks for, or null when the query starts nothing (e.g. after the URL becomes /runs/<id>). */
export function liveRunStart(q: URLSearchParams): { key: string; body: { inboxMessageId?: string; documentId?: string; rerunOf?: string } } | null {
  const body = { inboxMessageId: q.get("inbox") ?? undefined, documentId: q.get("document") ?? undefined, rerunOf: q.get("rerunOf") ?? undefined };
  if (!body.inboxMessageId && !body.documentId && !body.rerunOf) return null;
  return { key: q.toString(), body };
}
