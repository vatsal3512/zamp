import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import * as t from "./schema";
import type { Db } from "./pg-repo";
import { insertSeedRows } from "./demo-state";
import { SCENARIOS } from "../../fixtures/scenarios";
import type { ExtractedInvoice } from "@/domain/types";

export { resetDemoState } from "./demo-state";

const ALL_TABLES = [
  t.runEvents, t.runs, t.invoices, t.priorInvoices, t.auditLog, t.policies, t.inboxMessages, t.documents,
  t.goodsReceipts, t.purchaseOrders, t.vendors, t.uploadChunks, t.extractionCache,
];

/** Truncate everything and load the demo procurement system, inbox PDFs and (optionally) cached extractions. */
export async function seedDatabase(db: Db, opts: { withCache: boolean; root?: string }) {
  const root = opts.root ?? process.cwd();
  for (const table of ALL_TABLES) await db.delete(table);
  await insertSeedRows(db);
  await insertDocuments(db, root);
  if (opts.withCache) await insertCache(db, root);
}

async function insertDocuments(db: Db, root: string) {
  for (const [i, s] of SCENARIOS.entries()) {
    const bytes = new Uint8Array(await readFile(path.join(root, "fixtures/pdfs", s.file)));
    await db.insert(t.documents).values({ id: `doc-${s.id}`, filename: s.file, bytes });
    await db.insert(t.inboxMessages).values({
      id: `msg-${s.id}`, scenarioTag: s.tag, from: s.envelope.from, subject: s.envelope.subject, body: s.envelope.body,
      receivedAt: s.envelope.receivedAt, documentId: `doc-${s.id}`, sortOrder: i,
    });
  }
}

async function insertCache(db: Db, root: string) {
  const dir = path.join(root, "fixtures/extractions");
  if (!existsSync(dir)) return;
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json"))) {
    const { _model, ...invoice } = JSON.parse(await readFile(path.join(dir, f), "utf8")) as ExtractedInvoice & { _model: string };
    await db.insert(t.extractionCache).values({ key: f.replace(/\.json$/, "").replace(/\.reextract$/, ":reextract"), model: _model, body: invoice });
  }
}

// CLI: npm run db:seed
if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  (async () => {
    const { getDb } = await import("./client");
    await seedDatabase(getDb(), { withCache: true });
    console.log("Seeded.");
    process.exit(0);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
