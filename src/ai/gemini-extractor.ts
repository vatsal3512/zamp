import type { GoogleGenAI } from "@google/genai";
import { callWithFallback, type Attempt } from "./key-pool";
import { extractionJsonSchema, parseExtraction } from "./schema";
import { extractionPrompt, reextractPrompt } from "./prompt";
import type { ExtractResult, Extractor } from "@/pipeline/ports";

export class ExtractionInvalidError extends Error {
  constructor(public detail: string) {
    super(`Model returned an invalid extraction: ${detail}`);
    this.name = "ExtractionInvalidError";
  }
}

type Client = Pick<GoogleGenAI, "models">;

export interface GeminiExtractorOptions {
  keys: string[];
  models: string[];
  withBoxes: boolean;
  client?: (key: string) => Client;
  onRetry?: (a: Attempt) => void;
  sleep?: (ms: number) => Promise<void>;
}

export class GeminiExtractor implements Extractor {
  constructor(private opts: GeminiExtractorOptions) {}

  private async client(key: string): Promise<Client> {
    if (this.opts.client) return this.opts.client(key);
    const { GoogleGenAI } = await import("@google/genai");
    return new GoogleGenAI({ apiKey: key });
  }

  async extract(pdf: Uint8Array, _sha256: string, opts?: { reextract?: { reason: string } }): Promise<ExtractResult> {
    const data = Buffer.from(pdf).toString("base64");
    const prompt = opts?.reextract ? reextractPrompt(this.opts.withBoxes, opts.reextract.reason) : extractionPrompt(this.opts.withBoxes);
    const schema = extractionJsonSchema(this.opts.withBoxes);

    const { value, model, attempts } = await callWithFallback(
      this.opts.keys,
      this.opts.models,
      async (key, model) => {
        const client = await this.client(key);
        let lastError = "";
        // An unparseable answer is retried once on the same key/model, then treated as fatal.
        for (let i = 0; i < 2; i++) {
          const res = await client.models.generateContent({
            model,
            contents: [{ inlineData: { mimeType: "application/pdf", data } }, { text: prompt }],
            config: { responseMimeType: "application/json", responseJsonSchema: schema },
          });
          const parsed = parseExtraction(res.text ?? "");
          if (parsed.ok) return parsed.value;
          lastError = parsed.error;
        }
        throw new ExtractionInvalidError(lastError);
      },
      { onRetry: this.opts.onRetry, sleep: this.opts.sleep },
    );
    return { invoice: value, model, cached: false, attempts };
  }
}
