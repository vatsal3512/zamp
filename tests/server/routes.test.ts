import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SCENARIOS } from "../../fixtures/scenarios";
import { extractionFor } from "../../fixtures/doc-to-extraction";
import { parseSseChunk } from "@/server/sse";
import type { ExtractedInvoice } from "@/domain/types";

process.env.REPO = "memory";
const pdf = (f: string) => new Uint8Array(readFileSync(`fixtures/pdfs/${f}`));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let runs: typeof import("@/app/api/runs/route");
let docs: typeof import("@/app/api/documents/route");
let policy: typeof import("@/app/api/policy/route");
let override: typeof import("@/app/api/runs/[id]/override/route");
let reset: typeof import("@/app/api/demo/reset/route");

beforeAll(async () => {
  const bySha = new Map<string, ExtractedInvoice>(SCENARIOS.map((s) => [sha(pdf(s.file)), extractionFor(s.id)]));
  (globalThis as any).__extractorOverride = {
    extract: async (_p: Uint8Array, h: string) => {
      const invoice = bySha.get(h) ?? extractionFor("happy");
      return { invoice: structuredClone(invoice), model: "fake", cached: false, attempts: [] };
    },
  };
  [runs, docs, policy, override, reset] = await Promise.all([
    import("@/app/api/runs/route"), import("@/app/api/documents/route"), import("@/app/api/policy/route"),
    import("@/app/api/runs/[id]/override/route"), import("@/app/api/demo/reset/route"),
  ]);
});
beforeEach(async () => {
  await reset.POST();
});

const post = (url: string, body: unknown) => new Request(`http://test${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
async function streamRun(body: unknown) {
  const res = await runs.POST(post("/api/runs", body));
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  return parseSseChunk(await res.text()).events;
}
async function upload(bytes: Uint8Array, filename: string, chunk = 3 * 1024 * 1024) {
  const count = Math.max(1, Math.ceil(bytes.length / chunk));
  let res: Response | undefined;
  for (let i = 0; i < count; i++) {
    res = await docs.POST(new Request("http://test/api/documents", {
      method: "POST", body: bytes.slice(i * chunk, (i + 1) * chunk),
      headers: { "x-upload-id": `u-${filename}`, "x-chunk-index": String(i), "x-chunk-count": String(count), "x-filename": filename },
    }));
  }
  return res!;
}

describe("POST /api/runs", () => {
  it("streams a run from the inbox to a done event", async () => {
    const events = await streamRun({ inboxMessageId: "msg-happy" });
    expect(events.at(-1)!.type).toBe("done");
    expect((events.find((e) => e.type === "decision")!.data as any).outcome).toBe("APPROVE");
  });

  it("returns 404 for an unknown document", async () => {
    expect((await runs.POST(post("/api/runs", { documentId: "nope" }))).status).toBe(404);
  });
});

describe("POST /api/documents (chunked upload)", () => {
  it("rejects files that are not PDF, JPG or PNG", async () => {
    const res = await upload(new TextEncoder().encode("hello world"), "notes.txt");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("PDF, JPG or PNG");
  });

  it("rejects files over 12 MB", async () => {
    expect((await upload(new Uint8Array(13 * 1024 * 1024).fill(37), "big.pdf")).status).toBe(413);
  });

  it("accepts the 4.7 MB candidate guide in two chunks, byte-for-byte", async () => {
    const bytes = pdf("zamp-candidate-guide.pdf");
    const res = await upload(bytes, "guide.pdf");
    const { documentId } = await res.json();
    const getDoc = await import("@/app/api/documents/[id]/route");
    const back = new Uint8Array(await (await getDoc.GET(new Request("http://test"), { params: Promise.resolve({ id: documentId }) })).arrayBuffer());
    expect(sha(back)).toBe(sha(bytes));
  });

  it("wraps a phone photo into a PDF", async () => {
    const res = await upload(pdf("acme-AC-5531-photo.jpg"), "photo.jpg");
    const { documentId } = await res.json();
    const getDoc = await import("@/app/api/documents/[id]/route");
    const back = new Uint8Array(await (await getDoc.GET(new Request("http://test"), { params: Promise.resolve({ id: documentId }) })).arrayBuffer());
    expect(new TextDecoder().decode(back.slice(0, 4))).toBe("%PDF");
  });
});

describe("policy and overrides", () => {
  it("rejects an out-of-range tolerance", async () => {
    const current = await (await policy.GET()).json();
    const res = await policy.PUT(new Request("http://test/api/policy", { method: "PUT", body: JSON.stringify({ ...current, priceTolPct: 0.5 }) }));
    expect(res.status).toBe(400);
  });

  it("requires a reason to override", async () => {
    const events = await streamRun({ inboxMessageId: "msg-pv" });
    const runId = events[0].runId;
    const res = await override.POST(post(`/api/runs/${runId}/override`, { action: "approve", reason: "" }), { params: Promise.resolve({ id: runId }) });
    expect(res.status).toBe(400);
  });

  it("approves a held invoice with a reason and posts it to the ledger", async () => {
    const events = await streamRun({ inboxMessageId: "msg-pv" });
    const runId = events[0].runId;
    const res = await override.POST(post(`/api/runs/${runId}/override`, { action: "approve", reason: "Price increase agreed by procurement" }), { params: Promise.resolve({ id: runId }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ledger).toBe("Ledger write verified: PO-2052 $0.00 → $1,042.00");
    expect(body.run.override.action).toBe("approve");
  });
});
