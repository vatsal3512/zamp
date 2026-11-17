/**
 * Disk access for CLI scripts and tests only. Never import this from app/ or server/: Next traces dynamic file
 * reads, and these would pull the whole project into the deployed server bundle.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CachedExtraction, ExtractionStore } from "@/ai/cached-extractor";
import type { PdfLoader } from "@/pipeline/eval";

/** Recorded extractions as JSON files (":" in keys becomes "." in file names). */
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

/** Scenario PDFs from fixtures/pdfs. */
export const pdfFromDisk = (pdfDir = "fixtures/pdfs"): PdfLoader => async (s) =>
  new Uint8Array(await readFile(path.resolve(process.cwd(), pdfDir, s.file)));
