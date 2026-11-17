import * as t from "./schema";
import type { Db } from "./pg-repo";
import { SEED } from "../../fixtures/seed-data";

// No file I/O in this module: it ships in the server bundle (the seeder with its file reads is CLI-only).

const DEMO_STATE_TABLES = [t.runEvents, t.runs, t.invoices, t.priorInvoices, t.auditLog, t.policies, t.goodsReceipts, t.purchaseOrders, t.vendors, t.uploadChunks];

/** "Reset demo data": restore procurement state, policy and history; keep documents, inbox and the extraction cache. No file I/O. */
export async function resetDemoState(db: Db) {
  for (const table of DEMO_STATE_TABLES) await db.delete(table);
  await insertSeedRows(db);
}

export async function insertSeedRows(db: Db) {
  await db.insert(t.vendors).values(SEED.vendors);
  await db.insert(t.purchaseOrders).values(SEED.purchaseOrders);
  await db.insert(t.goodsReceipts).values(SEED.goodsReceipts);
  await db.insert(t.priorInvoices).values(SEED.priorInvoices);
  const { version, ...body } = SEED.policy;
  await db.insert(t.policies).values({ version, body });
}
