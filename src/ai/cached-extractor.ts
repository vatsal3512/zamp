import type { ExtractedInvoice } from "@/domain/types";
import type { ExtractOptions, ExtractResult, Extractor } from "@/pipeline/ports";

export type CachedExtraction = ExtractedInvoice & { _model: string };

export interface ExtractionStore {
  get(key: string): Promise<CachedExtraction | null>;
  set(key: string, model: string, v: ExtractedInvoice): Promise<void>;
}

/**
 * Cache-first wrapper. Key = sha256, or `${sha256}:reextract` for the arithmetic re-read.
 * `fresh` skips the cache read (a live model call). A live result only fills an empty slot unless `refresh` is set:
 * the recorded readings back the eval suite and the fallback, so the app never overwrites them. If a live call fails
 * for any reason and a recorded reading exists, that reading is returned, labelled cached.
 */
export class CachedExtractor implements Extractor {
  constructor(private inner: Extractor, private store: ExtractionStore, private opts: { refresh?: boolean } = {}) {}

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
      if (this.opts.refresh || !(await this.store.get(key))) await this.store.set(key, r.model, r.invoice);
      return r;
    } catch (e) {
      const cached = await hit();
      if (cached) return cached; // labelled replay: cached === true
      throw e;
    }
  }
}
