import type {
  Cents, Decision, ExtractedInvoice, Finding, InboxEnvelope, PurchaseOrder, RuleHit, RunEvent, StageId, StageResult, Vendor,
} from "@/domain/types";
import type { Emit, Extractor, Repo } from "./ports";
import { formatUsd, toCents } from "@/domain/money";
import { ExtractionInvalidError } from "@/ai/gemini-extractor";
import { inspect } from "./stages/inspect";
import { validate } from "./stages/validate";
import { vendorCheck } from "./stages/vendor";
import { poLookup } from "./stages/po";
import { match } from "./stages/match";
import { duplicateCheck } from "./stages/duplicate";
import { decide } from "./stages/decide";

export interface RunInput {
  documentId: string; pdf: Uint8Array; envelope: InboxEnvelope | null;
  source: "inbox" | "upload" | "rerun"; rerunOf?: string; fresh?: boolean;
}
export interface RunDeps { repo: Repo; extractor: Extractor; emit: Emit; company: { name: string; aliases: string[] }; now?: () => Date }

export const STAGE_LABELS: Record<StageId, string> = {
  intake: "Intake", inspect: "Inspect document", extract: "Extract fields", validate: "Validate extraction",
  vendor: "Vendor check", po: "Find purchase order", match: "3-way match", duplicate: "Duplicate & fraud", decide: "Decide", act: "Act & explain",
};

class LedgerMismatchError extends Error {}

/** Post an approved invoice to the PO ledger, then read it back to confirm the write. */
export async function postAndVerify(repo: Repo, poNumber: string, invoiceId: string, amountCents: Cents) {
  const { beforeCents, afterCents } = await repo.postToLedger(poNumber, invoiceId, amountCents);
  const back = await repo.readBackLedger(poNumber, invoiceId);
  const ok = afterCents === beforeCents + amountCents && back.billedToDateCents === afterCents && back.invoicePosted;
  const text = ok
    ? `Ledger write verified: ${poNumber} ${formatUsd(beforeCents)} → ${formatUsd(afterCents)}`
    : `Ledger read-back mismatch on ${poNumber}: expected ${formatUsd(beforeCents + amountCents)}, read ${formatUsd(back.billedToDateCents)}`;
  return { ok, beforeCents, afterCents, text };
}

const normPo = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, "");

export async function runPipeline(input: RunInput, deps: RunDeps): Promise<{ runId: string; decision: Decision | null; failed: boolean }> {
  const { repo, extractor } = deps;
  const now = deps.now ?? (() => new Date());
  const t0 = Date.now();
  const policy = await repo.getPolicy();
  const { runId } = await repo.createRun({ documentId: input.documentId, source: input.source, rerunOf: input.rerunOf, policyVersion: policy.version });

  // ---- events: numbered, persisted, streamed; emitter failures never stop the run ----
  let seq = 0;
  const persisted: Promise<void>[] = [];
  const send = (e: Omit<RunEvent, "runId" | "seq" | "at">) => {
    const ev: RunEvent = { ...e, runId, seq: ++seq, at: now().toISOString() };
    persisted.push(repo.appendEvent(ev).catch((err) => console.error("appendEvent failed", err)));
    try {
      deps.emit(ev);
    } catch {
      /* viewer gone — keep going */
    }
  };
  async function stage<T>(id: StageId, fn: () => Promise<StageResult<T>>, summary?: (r: StageResult<T>) => Record<string, unknown>) {
    send({ stage: id, type: "started", data: { label: STAGE_LABELS[id] } });
    const started = Date.now();
    try {
      const r = await fn();
      for (const f of r.findings) send({ stage: id, type: "finding", data: f });
      send({ stage: id, type: "completed", durationMs: Date.now() - started, data: { hits: r.hits, halt: !!r.halt, ...(summary?.(r) ?? {}) } });
      return r;
    } catch (e) {
      send({ stage: id, type: "failed", durationMs: Date.now() - started, data: { text: e instanceof Error ? e.message : String(e) } });
      throw e;
    }
  }
  const ok = <T>(data: T, findings: Finding[] = [], hits: RuleHit[] = [], halt = false): StageResult<T> => ({ hits, findings, data, halt });

  const hits: RuleHit[] = [];
  let decision: Decision | null = null;
  let invoice: ExtractedInvoice | null = null;
  let vendor: Vendor | null = null;
  let po: PurchaseOrder | null = null;
  let subtotalCents = 0;
  let model: string | null = null;
  let cached = false;
  let failed = false;

  try {
    await stage("intake", async () =>
      ok({ source: input.source, documentId: input.documentId }, [{
        level: "ok",
        text: input.envelope ? `Email from ${input.envelope.from}: "${input.envelope.subject}"` : input.source === "rerun" ? "Re-run against the current AOP" : "Uploaded document",
      }]), (r) => r.data);

    let halted = false;
    const ins = await stage("inspect", async () => {
      const r = await inspect(input.pdf);
      if (!r.halt && input.source !== "rerun") {
        const prior = await repo.findAcceptedInvoiceByHash(r.data.sha256);
        if (prior) {
          r.hits.push({ rule: "R-DOC-01", outcome: "REJECT", facts: { original: prior.invoiceNumber } });
          r.findings.push({ level: "error", text: `Exact same file as ${prior.invoiceNumber}, already accepted` });
          r.halt = true;
        }
      }
      return r;
    }, (r) => ({ pages: r.data.pages, kind: r.data.kind, sha256: r.data.sha256 }));
    hits.push(...ins.hits);
    halted = !!ins.halt;
    const sha = ins.data.sha256;
    const onRetry = (a: { key: number; model: string; kind: string }) =>
      send({ stage: "extract", type: "retrying", data: { key: a.key, model: a.model, kind: a.kind } });

    if (!halted) {
      const ex = await stage("extract", async () => {
        try {
          const r = await extractor.extract(input.pdf, sha, { fresh: input.fresh, onRetry });
          invoice = r.invoice;
          model = r.model;
          cached = r.cached;
          const filled = Object.values(r.invoice).filter((v) => v && typeof v === "object" && "value" in v && (v as { value: unknown }).value !== null).length;
          return ok(r, [{ level: "ok", text: `Read ${filled} fields and ${r.invoice.lines.length} line items with ${r.model}${r.cached ? " (cached)" : ""}` }]);
        } catch (e) {
          if (!(e instanceof ExtractionInvalidError)) throw e;
          return ok(null, [{ level: "error", text: "The model could not produce a readable extraction" }],
            [{ rule: "R-EXT-01", outcome: "HOLD", facts: { missing: "a readable extraction" } }], true);
        }
      }, () => ({ model, cached, invoice }));
      hits.push(...ex.hits);
      halted = !!ex.halt;
    }

    let netLines: ReturnType<typeof validate>["data"]["netLines"] = [];
    if (!halted && invoice) {
      const v = await stage("validate", async () => {
        const ctx = { pageTexts: ins.data.pageTexts, kind: ins.data.kind, company: deps.company, policy };
        let r = validate(invoice!, ctx);
        if (!r.halt && !r.data.arithmeticOk) {
          const reason = r.data.arithmeticReason!;
          const findings = [...r.findings, { level: "info" as const, text: "Totals don't reconcile — re-reading the document once" }];
          try {
            const re = await extractor.extract(input.pdf, sha, { reextract: { reason }, fresh: input.fresh, onRetry });
            invoice = re.invoice;
            r = validate(re.invoice, ctx);
            r.findings = [...findings, ...r.findings];
          } catch {
            r.findings = [...findings, { level: "warn", text: "Re-read failed; keeping the first reading" }];
          }
          if (!r.halt && !r.data.arithmeticOk) r.hits.push({ rule: "R-EXT-02", outcome: "HOLD", facts: { reason: r.data.arithmeticReason ?? reason } });
        }
        return r;
      }, (r) => ({ netLines: r.data.netLines, quoteChecks: r.data.quoteChecks, taxCents: r.data.taxCents, invoice }));
      hits.push(...v.hits);
      halted = !!v.halt;
      netLines = v.data.netLines;
    }

    const vendors = await repo.getVendors();
    if (!halted && invoice) {
      const vr = await stage("vendor", async () => vendorCheck(invoice!, vendors, input.envelope), (r) => ({ vendor: r.data.vendor }));
      hits.push(...vr.hits);
      halted = !!vr.halt;
      vendor = vr.data.vendor;
    }

    if (!halted && invoice && vendor) {
      const inv: ExtractedInvoice = invoice;
      const v: Vendor = vendor;
      const ref = inv.poNumber.value ? normPo(inv.poNumber.value) : null;
      const explicit = ref ? await repo.getPurchaseOrder(ref) : null;
      const open = await repo.getOpenPurchaseOrders(v.id);
      const pr = await stage("po", async () =>
        poLookup(inv, netLines, v, (n) => (n === ref ? explicit : null), open, policy, (id) => vendors.find((x) => x.id === id)?.legalName ?? id),
      (r) => ({ po: r.data.po, inferred: r.data.inferred, candidates: r.data.candidates }));
      hits.push(...pr.hits);
      halted = !!pr.halt;
      po = pr.data.po;
    }

    if (!halted && invoice && po) {
      const p: PurchaseOrder = po;
      const total = toCents((invoice as ExtractedInvoice).total.value ?? 0);
      const grns = await repo.getGoodsReceipts(p.poNumber);
      const mr = await stage("match", async () => match(netLines, total, p, grns, policy), (r) => ({ ...r.data, po: p, grns, netLines }));
      hits.push(...mr.hits);
      subtotalCents = mr.data.invoiceSubtotalCents;
    }

    if (!halted && invoice && vendor) {
      const v: Vendor = vendor;
      const priors = (await repo.getPriorInvoices(v.id)).filter((p) => !(input.source === "rerun" && p.sha256 === sha));
      const dr = await stage("duplicate", async () => duplicateCheck(invoice!, v.id, priors, policy), (r) => ({ best: r.data.best }));
      hits.push(...dr.hits);
    }

    const inv = invoice as ExtractedInvoice | null;
    await stage("decide", async () => {
      decision = decide(hits, {
        policy, vendor, invoiceNumber: inv?.invoiceNumber.value ?? null,
        totalCents: inv?.total.value != null ? toCents(inv.total.value) : null,
      });
      return ok(decision, [{ level: decision.outcome === "APPROVE" ? "ok" : decision.outcome === "REJECT" ? "error" : "warn", text: decision.summary }]);
    });
    send({ stage: "decide", type: "decision", data: decision });

    await stage("act", async () => {
      const d = decision!;
      const findings: Finding[] = [];
      const { invoiceId } = await repo.saveInvoiceResult({
        runId, documentId: input.documentId, sha256: sha, vendorId: vendor?.id ?? null, poNumber: po?.poNumber ?? null, extracted: inv, decision: d,
      });
      if (d.email) findings.push({ level: "info", text: `Drafted email to ${d.email.to}` });
      if (d.outcome === "APPROVE" && po) {
        const posted = await postAndVerify(repo, (po as PurchaseOrder).poNumber, invoiceId, subtotalCents);
        if (!posted.ok) throw new LedgerMismatchError(posted.text);
        findings.push({ level: "ok", text: posted.text });
      } else if (d.outcome === "ROUTE_FOR_APPROVAL") findings.push({ level: "info", text: "Waiting for sign-off before posting to the ledger" });
      else if (d.outcome !== "APPROVE") findings.push({ level: "info", text: "Not posted — needs a decision from a person" });
      return ok({ invoiceId }, findings);
    });
  } catch (e) {
    failed = true;
    if (!(e instanceof LedgerMismatchError)) console.error("run failed", e);
  }

  const outcome = failed ? "FAILED" : (decision as Decision | null)?.outcome ?? "FAILED";
  send({ stage: "act", type: "done", durationMs: Date.now() - t0, data: { runId, outcome, failed } });
  await Promise.all(persisted);
  await repo.finishRun(runId, { outcome, durationMs: Date.now() - t0, model, cached });
  return { runId, decision, failed };
}
