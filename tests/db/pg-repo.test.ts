import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { PgRepo } from "@/db/pg-repo";
import { seedDatabase } from "@/db/seed";
import { DEFAULT_POLICY } from "@/domain/policy";
import type { Decision } from "@/domain/types";

let repo: PgRepo;
let db: ReturnType<typeof drizzle<typeof schema>>;

const approve: Decision = {
  outcome: "APPROVE", hits: [], primary: null, owner: null, summary: "Approved — touchless", reasons: [],
  question: null, email: null, paymentBlocked: false, fraudSignals: 0,
};

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  await seedDatabase(db, { withCache: false });
  repo = new PgRepo(db);
}, 60_000);

describe("PgRepo (PGlite)", () => {
  it("seeds the procurement system", async () => {
    expect((await repo.getPurchaseOrder("PO-2041"))!.billedToDateCents).toBe(3_200_000);
    expect(await repo.getOpenPurchaseOrders("V-STARK")).toHaveLength(2); // PO-2019 is closed
    expect((await repo.getPriorInvoices("V-GLOBEX"))[0].invoiceNumber).toBe("INV-10422");
    expect(await repo.listInbox()).toHaveLength(21);
  });

  it("stores scenario PDFs byte-for-byte", async () => {
    const happy = (await repo.listInbox()).find((m) => m.scenarioTag === "Happy")!;
    const doc = await repo.getDocument(happy.documentId);
    expect(Buffer.from(doc!.bytes).equals(readFileSync("fixtures/pdfs/acme-AC-5531.pdf"))).toBe(true);
  });

  it("posts to the ledger in a transaction and reads it back", async () => {
    const { runId } = await repo.createRun({ documentId: "d1", source: "upload", policyVersion: 1 });
    const { invoiceId } = await repo.saveInvoiceResult({ runId, documentId: "d1", sha256: "abc", vendorId: "V-ACME", poNumber: "PO-2031", extracted: null, decision: approve });
    expect(await repo.postToLedger("PO-2031", invoiceId, 115_990)).toEqual({ beforeCents: 0, afterCents: 115_990 });
    expect(await repo.readBackLedger("PO-2031", invoiceId)).toEqual({ billedToDateCents: 115_990, invoicePosted: true });
  });

  it("records runs and their events in order", async () => {
    const { runId } = await repo.createRun({ documentId: "d2", source: "inbox", policyVersion: 1 });
    for (let seq = 1; seq <= 3; seq++) await repo.appendEvent({ runId, seq, stage: "intake", type: "finding", at: new Date().toISOString(), data: { n: seq } });
    await repo.finishRun(runId, { outcome: "HOLD", durationMs: 1200, model: "m", cached: true });
    const run = await repo.getRun(runId);
    expect(run!.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(run!.outcome).toBe("HOLD");
  });

  it("versions the AOP and audits the change", async () => {
    const { version: _v, ...body } = DEFAULT_POLICY;
    const p = await repo.savePolicy({ ...body, priceTolPct: 0.05 }, "reviewer");
    expect(p.version).toBe(2);
    expect((await repo.getPolicy()).priceTolPct).toBe(0.05);
    const audit = await repo.listAudit();
    expect(audit.some((a) => a.action === "policy.update" && (a.before as any).priceTolPct === 0.02 && (a.after as any).priceTolPct === 0.05)).toBe(true);
  });

  it("restores everything on reset", async () => {
    await seedDatabase(db, { withCache: false });
    expect((await repo.getPurchaseOrder("PO-2031"))!.billedToDateCents).toBe(0);
    expect((await repo.getPolicy()).version).toBe(1);
    expect(await repo.listRuns()).toEqual([]);
  });
});
