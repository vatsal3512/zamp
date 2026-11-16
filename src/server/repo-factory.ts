import type { AppRepo, Extractor } from "@/pipeline/ports";
import { MemoryRepo } from "@/db/memory-repo";
import { PgRepo } from "@/db/pg-repo";
import { CachedExtractor, type ExtractionStore } from "@/ai/cached-extractor";
import { GeminiExtractor } from "@/ai/gemini-extractor";
import { AllProvidersExhaustedError } from "@/ai/key-pool";

const g = globalThis as unknown as { __repo?: AppRepo; __extractorOverride?: Extractor };
const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Postgres (Neon) in normal use; in-memory when REPO=memory (tests, offline dev). Cached on globalThis across hot reloads. */
export async function getRepo(): Promise<AppRepo> {
  if (g.__repo) return g.__repo;
  if (process.env.REPO === "memory") g.__repo = new MemoryRepo();
  else {
    const { getDb } = await import("@/db/client");
    g.__repo = new PgRepo(getDb());
  }
  return g.__repo;
}

export async function resetDemo(): Promise<void> {
  const repo = await getRepo();
  if (repo instanceof MemoryRepo) return repo.reset();
  const [{ getDb }, { resetDemoState }] = await Promise.all([import("@/db/client"), import("@/db/seed")]);
  await resetDemoState(getDb());
}

export const dbCacheStore = (repo: AppRepo): ExtractionStore => ({ get: (k) => repo.getCache(k), set: (k, m, v) => repo.setCache(k, m, v) });

/**
 * Offline dev mode (EXTRACTOR=fixtures): returns each fixture PDF's known printed content, keyed by file hash.
 * Unknown files fail as unreadable. Labelled "fixtures (offline)" everywhere it appears — never used in production.
 */
async function fixtureExtractor(): Promise<Extractor> {
  const [{ createHash }, { readFileSync }, { SCENARIOS }, { extractionFor }, { ExtractionInvalidError }] = await Promise.all([
    import("node:crypto"), import("node:fs"), import("../../fixtures/scenarios"), import("../../fixtures/doc-to-extraction"), import("@/ai/gemini-extractor"),
  ]);
  const bySha = new Map(SCENARIOS.map((s) => [createHash("sha256").update(readFileSync(`fixtures/pdfs/${s.file}`)).digest("hex"), s.id]));
  return {
    extract: async (_pdf, sha) => {
      const id = bySha.get(sha);
      if (!id) throw new ExtractionInvalidError("offline fixtures mode only knows the demo PDFs");
      return { invoice: extractionFor(id), model: "fixtures (offline)", cached: false, attempts: [] };
    },
  };
}

/** Gemini behind the key pool, model chain and the extraction cache. */
export async function getExtractor(repo: AppRepo): Promise<Extractor> {
  if (g.__extractorOverride) return g.__extractorOverride;
  if (process.env.EXTRACTOR === "fixtures") return (g.__extractorOverride = await fixtureExtractor());
  const gemini = new GeminiExtractor({
    keys: list(process.env.GEMINI_API_KEYS),
    models: list(process.env.GEMINI_MODELS),
    withBoxes: process.env.EXTRACT_BOXES === "true",
  });
  return new CachedExtractor(gemini, dbCacheStore(repo));
}

/** Cache-only extractor (no network) — used by the eval badge so it never spends quota. */
export function getCacheOnlyExtractor(repo: AppRepo): Extractor {
  if (g.__extractorOverride) return g.__extractorOverride;
  const never: Extractor = { extract: async () => { throw new AllProvidersExhaustedError([]); } };
  return new CachedExtractor(never, dbCacheStore(repo));
}
