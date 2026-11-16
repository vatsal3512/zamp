import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractedInvoice } from "@/domain/types";
import type { ExtractOptions, ExtractResult, Extractor } from "@/pipeline/ports";
import { AllProvidersExhaustedError } from "./key-pool";

export type CachedExtraction = ExtractedInvoice & { _model: string };

export interface ExtractionStore {
  get(key: string): Promise<CachedExtraction | null>;
  set(key: string, model: string, v: ExtractedInvoice): Promise<void>;
}

/** Cache-first wrapper. Key = sha256, or `${sha256}:reextract` for the arithmetic re-read. */
export class CachedExtractor implements Extractor {
  constructor(private inner: Extractor, private store: ExtractionStore) {}

  async extract(pdf: Uint8Array, sha256: string, opts?: ExtractOptions): Promise<ExtractResult> {
    const key = opts?.reextract ? `${sha256}:reextract` : sha256;
    const hit = async (): Promise<ExtractResult | null> => {
      const c = await this.store.get(key);
      if (!c) return null;
      const { _model, ...invoice } = c;
      return { invoice, model: _model, cached: true, attempts: [] };
    };

    if (!opts?.fresh) {
      const cached = await hit();
      if (cached) return cached;
    }
    try {
      const r = await this.inner.extract(pdf, sha256, opts);
      await this.store.set(key, r.model, r.invoice);
      return r;
    } catch (e) {
      if (e instanceof AllProvidersExhaustedError) {
        const cached = await hit();
        if (cached) return cached; // labelled replay: cached === true
      }
      throw e;
    }
  }
}

/** JSON files on disk — used by eval and bake-off scripts. */
export function fileCacheStore(dir = "fixtures/extractions"): ExtractionStore {
  const file = (key: string) => path.resolve(dir, `${key.replace(/:/g, ".")}.json`);
  return {
    async get(key) {
      try {
        return JSON.parse(await readFile(file(key), "utf8")) as CachedExtraction;
      } catch {
        return null;
      }
    },
    async set(key, model, v) {
      await mkdir(path.resolve(dir), { recursive: true });
      await writeFile(file(key), JSON.stringify({ ...v, _model: model }, null, 2));
    },
  };
}
