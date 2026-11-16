import { describe, expect, it, vi } from "vitest";
import { ExtractionInvalidError, GeminiExtractor } from "@/ai/gemini-extractor";
import { CachedExtractor } from "@/ai/cached-extractor";
import { AllProvidersExhaustedError } from "@/ai/key-pool";
import type { Extractor } from "@/pipeline/ports";
import type { ExtractedInvoice } from "@/domain/types";
import { extractionFor } from "../../fixtures/doc-to-extraction";

const PDF = new Uint8Array([37, 80, 68, 70]);
const valid = JSON.stringify(extractionFor("happy"));

function fakeClient(respond: (key: string, model: string) => string | Error) {
  return (key: string) => ({
    models: {
      generateContent: async ({ model }: { model: string }) => {
        const r = respond(key, model);
        if (r instanceof Error) throw r;
        return { text: r };
      },
    },
  }) as any;
}
const opts = { keys: ["k0", "k1"], models: ["m1", "m2"], withBoxes: false, sleep: async () => {} };

describe("GeminiExtractor", () => {
  it("returns the parsed extraction and the model used", async () => {
    const ex = new GeminiExtractor({ ...opts, client: fakeClient(() => valid) });
    const r = await ex.extract(PDF, "sha");
    expect(r.model).toBe("m1");
    expect(r.cached).toBe(false);
    expect(r.invoice.invoiceNumber.value).toBe("AC-5531");
  });

  it("retries an unparseable answer once, then gives up with ExtractionInvalidError", async () => {
    let calls = 0;
    const ex = new GeminiExtractor({ ...opts, client: fakeClient(() => (calls++, "not json")) });
    await expect(ex.extract(PDF, "sha")).rejects.toBeInstanceOf(ExtractionInvalidError);
    expect(calls).toBe(2);
  });

  it("moves to the next key on a quota error", async () => {
    const ex = new GeminiExtractor({
      ...opts,
      client: fakeClient((key) => (key === "k0" ? Object.assign(new Error("quota"), { status: 429 }) : valid)),
    });
    const r = await ex.extract(PDF, "sha");
    expect(r.attempts.map((a) => a.key)).toEqual([0, 1]);
  });
});

function memoryStore() {
  const m = new Map<string, ExtractedInvoice & { _model: string }>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, model: string, v: ExtractedInvoice) => void m.set(k, { ...v, _model: model }),
  };
}

describe("CachedExtractor", () => {
  const inv = extractionFor("happy");
  const inner = (impl?: () => never) => {
    const extract = vi.fn(async () => {
      if (impl) impl();
      return { invoice: inv, model: "m1", cached: false, attempts: [] };
    });
    return { extract } as Extractor & { extract: typeof extract };
  };

  it("serves the second call from cache", async () => {
    const i = inner();
    const c = new CachedExtractor(i, memoryStore());
    await c.extract(PDF, "abc");
    const r = await c.extract(PDF, "abc");
    expect(i.extract).toHaveBeenCalledTimes(1);
    expect(r.cached).toBe(true);
    expect(r.model).toBe("m1");
  });

  it("skips the cache read when fresh is requested", async () => {
    const i = inner();
    const c = new CachedExtractor(i, memoryStore());
    await c.extract(PDF, "abc");
    await c.extract(PDF, "abc", { fresh: true });
    expect(i.extract).toHaveBeenCalledTimes(2);
  });

  it("keeps re-extractions under a separate key", async () => {
    const store = memoryStore();
    const c = new CachedExtractor(inner(), store);
    await c.extract(PDF, "abc", { reextract: { reason: "x" } });
    expect([...store.m.keys()]).toEqual(["abc:reextract"]);
  });

  it("falls back to the cached copy when every provider is exhausted", async () => {
    const store = memoryStore();
    await store.set("abc", "m1", inv);
    const c = new CachedExtractor(inner(() => { throw new AllProvidersExhaustedError([]); }), store);
    const r = await c.extract(PDF, "abc", { fresh: true });
    expect(r.cached).toBe(true);
  });
});
