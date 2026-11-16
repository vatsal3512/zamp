# Invoice Agent (PS-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live, deployed web app that takes an invoice PDF, extracts it with evidence (Gemini, one call), runs deterministic AP checks against a simulated procurement system, and returns APPROVE / ROUTE_FOR_APPROVAL / HOLD / REJECT with plain-English reasons — streamed stage-by-stage, with a dashboard and an editable Operating Procedure.

**Architecture:** A pure TypeScript domain core (`src/domain`, `src/pipeline/stages`) — every stage is a pure function over plain data, unit-tested without DB or network. An orchestrator wires stages to two ports: `Extractor` (Gemini behind key pool + model chain + cache) and `Repo` (Postgres in prod, in-memory for tests/eval). Next.js route handlers stream `RunEvent`s over SSE; the UI plays them back through a paced reveal queue.

**Tech Stack:** Node 20+, TypeScript (strict), Next.js App Router, Tailwind + shadcn/ui (restyled flat), Geist + Geist Mono, Lucide, Framer Motion, Drizzle ORM + Neon Postgres (`@neondatabase/serverless` Pool, `ws`), `@google/genai`, `unpdf`, `react-pdf`, `zod`, Vitest; dev-only: Playwright, `sharp`, `pdf-lib`, `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-16-invoice-processing-design.md` (revision 4). Read it before any task — especially §4, §5 and §6b (brief coverage matrix).

## Global Constraints

- All money is integer **cents** (`Cents = number`) inside the app; the extractor's decimal numbers are converted once with `toCents()`; display only via `formatUsd()` → `$1,234.56`, signed variances `+$1,500.00`.
- The LLM never decides: outcomes come only from `decide()` over `RuleHit`s; summary/question/email come only from templates in `src/templates`.
- Exactly one AI call per invoice; a second only for the arithmetic re-extract (R-EXT-02 path).
- Rule IDs are exactly those in spec §5: `R-DOC-01..04, R-EXT-01..02, R-TAX-01, R-CUR-01, R-VEN-01..04, R-PO-01..04, R-TOL-01..02, R-LIN-01, R-BUN-01, R-FRT-01, R-GRN-01..02, R-DUP-01..02, R-APR-01` (R-SPL-01 is deferred).
- The extraction schema is lenient: every key required, every value nullable, no sign/range constraints. Meaning is judged in `validate`, never by the schema.
- Outcome precedence: `REJECT > HOLD > ROUTE_FOR_APPROVAL > APPROVE`.
- Default policy: price tolerance **2%** or **$50.00** (hold if either exceeded, per line or summed over the invoice); PO-overrun tolerance **0%**; freight cap **$100.00**; approval threshold **$25,000.00**; duplicate reject ≥ **0.85**, hold ≥ **0.60**, window **90 days**; quote similarity ≥ **0.90**; plausible tax rate **0–15%**.
- Gemini model IDs allowed: `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`. Never `gemini-2.5-flash`, `gemini-3-flash-preview`, `gemini-2.5-flash-lite`.
- Env: `GEMINI_API_KEYS` (comma-separated), `GEMINI_MODELS` (comma-separated, ordered), `DATABASE_URL`, `EXTRACT_BOXES` (`true|false`, default `false`), `TEST_DATABASE_URL` (optional, gates DB integration tests).
- Pipeline route handlers: `export const runtime = "nodejs"; export const maxDuration = 300; export const dynamic = "force-dynamic";`
- Uploads: PDF, JPEG or PNG, up to **12 MB**, sent in **3 MB chunks** (Vercel's request body cap is 4.5 MB; the Zamp Candidate Guide alone is 4.7 MB). Images are wrapped into a one-page PDF on arrival.
- Our company (bill-to): `"Northwind Labs, Inc."`, aliases `["Northwind Labs", "Northwind Labs Inc"]`.
- UI follows spec §10 "UI quality bar" exactly: flush hairline split panes (no floating card grids), monochrome palette (`#0A0A0A` / `#52525B` / `#71717A` ink, `#FFFFFF` + `#F7F7F5` surfaces, `#E4E4E7` borders, `#111827` primary button), no gradients / glows / sparkle or robot icons / decorative icon circles / chart libraries.
- Status pills (1px border + 6px dot), identical everywhere: APPROVE `Approved & posted` emerald, ROUTE_FOR_APPROVAL `Pending sign-off` blue, HOLD `Needs attention` amber, REJECT `Rejected` crimson.
- Type: Geist with `tabular-nums` for all amounts (right-aligned); Geist Mono for rule IDs, invoice/PO/GRN numbers, confidence, ms timings. Body 14px, table cells 13px, column headers 11px uppercase tracked — nothing else below 13px. Table rows 36–40px.
- Vocabulary: `Bills`, `Needs attention`, `Agent activity log`, `AOP & controls`, `POs & vendors`, `Straight-through rate`.
- Exact dependency versions (`npm config set save-exact true`).

## Review Focus

1. **Same invoice processed twice** (launcher clicked twice; Policy-flip re-run). Fresh intake of an already-accepted file → REJECT R-DOC-01; an explicit re-run (`rerunOf`) must bypass R-DOC-01. → test in Task 13.
2. **Interviewer uploads something odd** — the Zamp guide PDF (4.7 MB, not an invoice), a phone photo, corrupt bytes, encrypted PDF, a .docx, > 12 MB. Guide → REJECT R-DOC-02; photo → processed as a scan; unsupported type/oversize → HTTP 400/413 with a readable message, no run; corrupt/encrypted → HOLD R-DOC-04, never a 500. → tests in Tasks 6, 13 and 16.
3. **Model returns messy JSON** — nulls everywhere, lump-sum lines with no quantity, negative discount/credit lines, numbers as text. → must parse (lenient schema + coercion) and reach `validate`, which explains what's missing (R-EXT-01). Truly unparseable JSON → one retry, then HOLD R-EXT-01. → tests in Tasks 6 and 7.
4. **All keys and models exhausted with no cache** → stream ends with a terminal `failed` event and a visible error state; nothing hangs. → test in Tasks 2 and 13.
5. **Viewer navigates away mid-run** → pipeline still finishes and persists; replay of `/runs/[id]` shows the full run. Emitter errors must never abort the pipeline. → test in Task 13.

---

## File Structure

```
src/
  domain/
    types.ts            all shared types (Task 3)
    money.ts            toCents, formatUsd, formatSignedUsd, pct (Task 1)
    policy.ts           DEFAULT_POLICY (Task 3)
    text.ts             normalizeForQuote, quoteFound, normalizeInvoiceNumber, levenshtein, similarity, tokenJaccard (Task 5)
  ai/
    schema.ts           zod ExtractedInvoice schema + JSON schema export + parseExtraction (Task 6)
    prompt.ts           extraction + re-extract prompts (Task 6)
    key-pool.ts         callWithFallback (keys × models, retry/backoff) (Task 2)
    gemini-extractor.ts GeminiExtractor implements Extractor (Task 6)
    cached-extractor.ts CachedExtractor (cache-first wrapper) (Task 6)
  pipeline/
    stages/inspect.ts   (Task 6)  validate.ts (Task 7)  vendor.ts (Task 8)  po.ts (Task 9)
           match.ts (Task 10)  duplicate.ts (Task 11)  decide.ts (Task 12)
    run-pipeline.ts     orchestrator (Task 13)
    ports.ts            Extractor, Repo, Emit interfaces (Task 3)
  templates/explain.ts  summary/question/email per rule (Task 12)
  db/
    schema.ts  client.ts  pg-repo.ts  seed.ts (Task 15)
    memory-repo.ts      (Task 13)
  server/
    sse.ts  run-service.ts  repo-factory.ts  kpis.ts (Task 16)
app/
  layout.tsx  page.tsx (Bills)  needs-attention/page.tsx  vendors/page.tsx  aop/page.tsx
  runs/live/page.tsx  runs/[id]/page.tsx
  api/runs/route.ts  api/runs/[id]/route.ts  api/runs/[id]/override/route.ts
  api/documents/route.ts  api/documents/[id]/route.ts  api/inbox/route.ts
  api/policy/route.ts  api/demo/reset/route.ts  api/eval/route.ts
components/ ui/ (shadcn)  shell/  run/  dashboard/  settings/
fixtures/
  seed-data.ts  scenarios.ts  templates/*.html  pdfs/*.pdf  extractions/*.json
scripts/ check-models.ts  generate-fixtures.ts  bakeoff.ts  eval.ts
tests/   mirrors src/
```

Decision recorded here (builder call): the **AP Inbox doubles as the demo launcher** — every scenario is a seeded inbox email with its PDF; each row shows a small scenario tag (`EC-1`…). One list, not two.

---

## Phase 0 — Foundation (Day 1)

### Task 1: Scaffold project and money helpers

**Files:**
- Create: project via create-next-app, `vitest.config.ts`, `.env.example`, `src/domain/money.ts`
- Test: `tests/domain/money.test.ts`

**Interfaces:**
- Produces: `toCents(n: number): Cents` (round half away from zero), `formatUsd(c: Cents): string`, `formatSignedUsd(c: Cents): string`, `pct(part: number, whole: number): number` (fraction, not ×100), `formatPct(f: number, digits = 1): string`.

- [ ] **Step 1:** `git init`; `npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm`; `npm config set save-exact true`; `npm i -D vitest @vitest/coverage-v8 tsx`; add scripts `"test": "vitest run"`, `"test:watch": "vitest"`. Move `app/` under `src/app` if the CLI placed it there already — keep `src/app`. Create `.env.example` with every env var from Global Constraints. Add `fixtures/pdfs/*.pdf` is **not** ignored (they are committed).
- [ ] **Step 2: Write failing tests**

```ts
expect(toCents(1255.59)).toBe(125559);
expect(toCents(0.1 + 0.2)).toBe(30);
expect(formatUsd(4950000)).toBe("$49,500.00");
expect(formatSignedUsd(150000)).toBe("+$1,500.00");
expect(formatSignedUsd(-4200)).toBe("−$42.00");      // U+2212 minus
expect(pct(4200, 100000)).toBeCloseTo(0.042);
expect(formatPct(0.0312)).toBe("3.1%");
```

- [ ] **Step 3:** Run `npm test` → FAIL (module missing).
- [ ] **Step 4:** Implement `src/domain/money.ts` (use `Intl.NumberFormat("en-US", {style:"currency", currency:"USD"})`).
- [ ] **Step 5:** `npm test` → PASS; `npm run dev` serves the default page.
- [ ] **Step 6:** Commit `chore: scaffold next app, vitest, money helpers`.

### Task 2: Gemini key pool, model chain, smoke test

**Files:**
- Create: `src/ai/key-pool.ts`, `scripts/check-models.ts`
- Test: `tests/ai/key-pool.test.ts`

**Interfaces:**
- Produces:
```ts
export type CallErrorKind = "quota" | "model_unavailable" | "transient" | "fatal";
export function classifyError(e: unknown): CallErrorKind;
  // status 429 or message contains RESOURCE_EXHAUSTED → quota; 404 → model_unavailable;
  // >=500, UNAVAILABLE, DEADLINE_EXCEEDED, network errors → transient; else fatal
export interface Attempt { key: number; model: string; kind: CallErrorKind | "ok"; ms: number }
export async function callWithFallback<T>(
  keys: string[], models: string[],
  fn: (key: string, model: string) => Promise<T>,
  opts?: { backoffMs?: number[]; onRetry?: (a: Attempt) => void; sleep?: (ms: number) => Promise<void> }
): Promise<{ value: T; model: string; attempts: Attempt[] }>;
export class AllProvidersExhaustedError extends Error { attempts: Attempt[] }
```
Order: for each model (in order) → for each key → try; `transient` → retry same key/model with backoff `[500, 1500]` then move on; `quota` → next key; `model_unavailable` → next model; `fatal` → throw immediately.

- [ ] **Step 1: Write failing tests** (inject fake `fn` and instant `sleep`):
  - `quota on key0 → succeeds on key1, same model` → `attempts.map(a=>a.kind)` = `["quota","ok"]`, `model === "m1"`.
  - `404 on m1 for every key → falls to m2`.
  - `transient twice then ok` → 3 attempts on key0, `onRetry` called twice.
  - `all quota on all keys and models` → rejects with `AllProvidersExhaustedError`, `attempts.length === keys.length * models.length`.
  - `fatal (400) → throws immediately`, 1 attempt.
- [ ] **Step 2:** Run `npx vitest run tests/ai/key-pool.test.ts` → FAIL.
- [ ] **Step 3:** Implement `src/ai/key-pool.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Write `scripts/check-models.ts` (run with `npx tsx scripts/check-models.ts`): load `.env.local`; for each key: `ai.models.list()` and print which allowed IDs are present; for each allowed model with the first working key: build a one-page PDF in memory with `pdf-lib` (`npm i -D pdf-lib`) containing text `"INVOICE INV-1 TOTAL 12.34"`, call `ai.models.generateContent({ model, contents: [{ inlineData: { mimeType: "application/pdf", data: b64 } }, { text: "Return the invoice number, total, due date and document type." }], config: { responseMimeType: "application/json", responseJsonSchema: { type: "object", properties: { invoiceNumber: { type: "string" }, total: { type: "number" }, dueDate: { type: ["string", "null"] }, documentType: { type: "string", enum: ["invoice", "credit_note", "statement", "purchase_order", "quote", "receipt", "other"] } }, required: ["invoiceNumber", "total", "dueDate", "documentType"] } } })` — this proves the exact schema features we rely on (nullable values via type arrays, enums, all-required keys); print `model | ok/error | ms | parsed`. If `responseJsonSchema` is rejected by the installed SDK, switch the script (and later Task 6) to `responseSchema` with the SDK's `Type` enum and note it in the script header.
- [ ] **Step 6:** User adds real keys to `.env.local`; run the script. Expected: at least two allowed models print `ok` with `{"invoiceNumber":"INV-1","total":12.34,"dueDate":null,"documentType":"invoice"}`. If type arrays are rejected, switch nullable fields to `anyOf: [{type:"string"},{type:"null"}]` (or the SDK's `nullable: true` with `responseSchema`) and record which form works at the top of the script — Task 6 must use the same form. Record the working order into `GEMINI_MODELS` in `.env.local`.
- [ ] **Step 7:** Commit `feat(ai): key pool with model fallback + model smoke test`.

### Task 3: Domain types, policy, seed data, scenario manifest

**Files:**
- Create: `src/domain/types.ts`, `src/domain/policy.ts`, `src/pipeline/ports.ts`, `fixtures/seed-data.ts`, `fixtures/scenarios.ts`, `fixtures/brief-coverage.ts`
- Test: `tests/fixtures/seed-data.test.ts`

**Interfaces — Produces** (`src/domain/types.ts`; every later task uses these names):
```ts
export type Cents = number;
export type Outcome = "APPROVE" | "ROUTE_FOR_APPROVAL" | "HOLD" | "REJECT";
export type Owner = "AP" | "Procurement" | "Receiving" | "Treasury" | "Approver";
export type RuleId = "R-DOC-01"|"R-DOC-02"|"R-DOC-03"|"R-DOC-04"|"R-EXT-01"|"R-EXT-02"|"R-TAX-01"|"R-CUR-01"
  |"R-VEN-01"|"R-VEN-02"|"R-VEN-03"|"R-VEN-04"|"R-PO-01"|"R-PO-02"|"R-PO-03"|"R-PO-04"
  |"R-TOL-01"|"R-TOL-02"|"R-LIN-01"|"R-BUN-01"|"R-FRT-01"|"R-GRN-01"|"R-GRN-02"
  |"R-DUP-01"|"R-DUP-02"|"R-APR-01";
export type StageId = "intake"|"inspect"|"extract"|"validate"|"vendor"|"po"|"match"|"duplicate"|"decide"|"act";
export type Box = [number, number, number, number]; // [ymin,xmin,ymax,xmax] 0–1000
export interface Field<T> { value: T; quote: string | null; page: number | null; confidence: number; box?: Box }
export type LineType = "goods" | "service" | "freight" | "tax" | "discount" | "other";
export interface ExtractedLine { description: string | null; lineType: LineType | null;
  quantity: number | null; unitPrice: number | null; amount: number | null;   // nullable; may be negative
  quote: string | null; page: number | null; confidence: number; box?: Box }
export type DocumentType = "invoice" | "credit_note" | "statement" | "purchase_order" | "quote" | "receipt" | "other";
export interface ExtractedInvoice {
  documentType: DocumentType; documentTypeReason: string | null;
  invoiceNumber: Field<string|null>; invoiceDate: Field<string|null>; dueDate: Field<string|null>;
  vendorName: Field<string|null>; vendorTaxId: Field<string|null>; billTo: Field<string|null>;
  poNumber: Field<string|null>; currency: Field<string|null>; servicePeriod: Field<string|null>; // "YYYY-MM"
  taxInclusive: boolean | null; lines: ExtractedLine[];
  subtotal: Field<number|null>; taxTotal: Field<number|null>; total: Field<number|null>;
  bankAccount: Field<string|null>;
}
export interface Vendor { id: string; legalName: string; aliases: string[]; taxId: string;
  status: "approved" | "blocked" | "suspended" | "onboarding"; bankAccount: string; emailDomain: string; contactOnFile: string }
export interface PoLine { lineNo: number; description: string; quantity: number; unitPriceCents: Cents }
export interface PurchaseOrder { poNumber: string; vendorId: string; matchType: "2-way" | "3-way";
  currency: string; lines: PoLine[]; totalCents: Cents; billedToDateCents: Cents; status: "open" | "closed" | "cancelled" }
/** Line after Validate resolved nulls and tax basis — what Match consumes. */
export interface NetLine { index: number; description: string; lineType: LineType; quantity: number;
  unitCents: Cents; amountCents: Cents }   // pre-tax; lump-sum → quantity 1, unitCents = amountCents
export interface GoodsReceipt { grnNumber: string; poNumber: string; receivedAt: string;
  lines: { lineNo: number; quantityReceived: number }[] }
export interface PriorInvoice { invoiceId: string; vendorId: string; invoiceNumber: string; invoiceDate: string;
  totalCents: Cents; servicePeriod: string | null; lineDescriptions: string[]; outcome: Outcome; sha256: string }
export interface Policy { version: number; priceTolPct: number; priceTolAbsCents: Cents; poOverrunPct: number;
  freightCapCents: Cents; approvalThresholdCents: Cents; dupRejectScore: number; dupHoldScore: number; dupWindowDays: number;
  quoteMinSimilarity: number; maxTaxRate: number; owners: Record<RuleId, Owner> }
export interface Finding { level: "ok" | "info" | "warn" | "error"; text: string }
export interface RuleHit { rule: RuleId; outcome: Outcome | "NOTE"; facts: Record<string, string | number> }
export interface StageResult<T> { hits: RuleHit[]; findings: Finding[]; data: T; halt?: boolean }
export interface DraftEmail { to: string; subject: string; body: string }
export interface Decision { outcome: Outcome; hits: RuleHit[]; primary: RuleHit | null; owner: Owner | null;
  summary: string; reasons: string[]; question: string | null; email: DraftEmail | null;
  paymentBlocked: boolean; fraudSignals: number }
export type RunEventType = "started"|"finding"|"retrying"|"completed"|"failed"|"decision"|"done";
export interface RunEvent { runId: string; seq: number; stage: StageId; type: RunEventType;
  at: string; durationMs?: number; data?: unknown }
export interface InboxEnvelope { from: string; subject: string; body: string; receivedAt: string }
```
`src/domain/policy.ts`: `export const DEFAULT_POLICY: Policy` with the Global Constraints values (`priceTolPct: 0.02, priceTolAbsCents: 5000, poOverrunPct: 0, freightCapCents: 10000, approvalThresholdCents: 2_500_000, dupRejectScore: 0.85, dupHoldScore: 0.6, dupWindowDays: 90, quoteMinSimilarity: 0.9, maxTaxRate: 0.15, version: 1`) and `owners`: DOC/EXT/TAX/CUR/DUP → `AP`; VEN-01, VEN-04, PO-*, TOL-*, LIN-01, BUN-01, FRT-01 → `Procurement`; VEN-02/03 → `Treasury`; GRN-01/02 → `Receiving`; APR-01 → `Approver`.

`src/pipeline/ports.ts`:
```ts
export interface ExtractResult { invoice: ExtractedInvoice; model: string; cached: boolean; attempts: Attempt[] }
export interface Extractor { extract(pdf: Uint8Array, sha256: string, opts?: { reextract?: { reason: string } ; fresh?: boolean }): Promise<ExtractResult> }
export type Emit = (e: Omit<RunEvent, "runId" | "seq" | "at">) => void;
export interface Repo {
  getPolicy(): Promise<Policy>;
  getVendors(): Promise<Vendor[]>;
  getPurchaseOrder(poNumber: string): Promise<PurchaseOrder | null>;
  getOpenPurchaseOrders(vendorId: string): Promise<PurchaseOrder[]>;
  getGoodsReceipts(poNumber: string): Promise<GoodsReceipt[]>;
  getPriorInvoices(vendorId: string): Promise<PriorInvoice[]>;
  findAcceptedInvoiceByHash(sha256: string): Promise<PriorInvoice | null>; // outcome APPROVE|ROUTE_FOR_APPROVAL
  saveInvoiceResult(r: { runId: string; documentId: string; vendorId: string | null; poNumber: string | null;
    extracted: ExtractedInvoice | null; decision: Decision }): Promise<{ invoiceId: string }>;
  postToLedger(poNumber: string, invoiceId: string, amountCents: Cents): Promise<{ beforeCents: Cents; afterCents: Cents }>;
  readBackLedger(poNumber: string, invoiceId: string): Promise<{ billedToDateCents: Cents; invoicePosted: boolean }>;
  createRun(r: { documentId: string; source: "inbox" | "upload" | "rerun"; rerunOf?: string; policyVersion: number }): Promise<{ runId: string }>;
  appendEvent(e: RunEvent): Promise<void>;
  finishRun(runId: string, r: { outcome: Outcome | "FAILED"; durationMs: number; model: string | null; cached: boolean }): Promise<void>;
}
```

`fixtures/seed-data.ts` exports `COMPANY`, `VENDORS`, `PURCHASE_ORDERS`, `GOODS_RECEIPTS`, `PRIOR_INVOICES`, and `export interface SeedData { vendors: Vendor[]; purchaseOrders: PurchaseOrder[]; goodsReceipts: GoodsReceipt[]; priorInvoices: PriorInvoice[]; policy: Policy }` + `SEED: SeedData`, with exactly:

| PO | Vendor (id · name · domain · bank) | match | Lines (desc · qty · unit ¢) | Billed to date |
|---|---|---|---|---|
| PO-2031 | V-ACME · Acme Office Supplies, LLC · acmeoffice.com · 021000021-4417730001 | 3-way | A4 copy paper, 10-ream case · 20 · 4250; Ballpoint pens, box of 50 · 10 · 1899; Desk organizer · 5 · 2400 | 0 |
| PO-2041 | V-INITECH · Initech Managed Services · initech.io · 026009593-8812005521 | 2-way | Managed support hours · 384 · 12500 | 3,200,000 |
| PO-2052 | V-UMBRELLA · Umbrella Print Co. · umbrellaprint.com · 011000138-2290043318 | 3-way | Toner cartridge, black, high-yield · 40 · 2500 | 0 |
| PO-2063 | V-GLOBEX · Globex Corporation · globex.com · 121000248-5560910492 | 2-way | Monthly platform subscription · 12 · 240000 | 240,000 |
| PO-2064 | V-GLOBEX | 2-way | Rack server maintenance kit · 2 · 493500 | 0 |
| PO-2077 | V-STARK · Stark Industrial Parts · starkparts.com · 071000013-3301776620 | 3-way | Hex bolt M8x40, box of 100 · 12 · 3450; Steel washer M8, box of 200 · 12 · 1275; Nylon lock nut M8, box of 100 · 6 · 2890 | 0 |
| PO-2081 | V-STARK | 3-way | Hydraulic hose 1/2in, 50ft · 4 · 18900; Hose clamp kit · 10 · 1450 | 0 |
| PO-2090 | V-SOYLENT · Soylent Catering · soylentcatering.com · 091000019-6610028841 | 2-way | Catering — all-hands lunch, per head · 320 · 1850; Coffee & beverage service · 1 · 118000; Delivery & setup · 1 · 24000 | 0 |

| PO-2033 | V-ACME | 3-way | same three lines as PO-2031 | 0 |
| PO-2034 | V-ACME | 3-way | Ergonomic office chair · 4 · 28900 | 0 |
| PO-2058 | V-UMBRELLA | 3-way | Glossy A3 paper, ream · 30 · 1650 | 0 |
| PO-2019 | V-STARK (status **closed**) | 3-way | Hex bolt M8x40, box of 100 · 10 · 3450 | 34,500 |
| PO-2095 | V-PIXEL · Pixel & Co. Design Studio · pixelco.design · 122105155-7781230094 | 2-way | Discovery & design · 1 · 100000; Build & integration · 1 · 200000; QA & launch · 1 · 50000 | 0 |

Plus `V-VANDELAY · Vandelay Imports · vandelay.com · status "blocked"` (no PO). GRNs: full receipt for PO-2031 (GRN-1031), PO-2033 (GRN-1033), PO-2034 (GRN-1034), PO-2052 (GRN-1052), PO-2077 (GRN-1077), PO-2019 (GRN-1019); **none** for PO-2058. Prior invoices: `INI-0901` and `INI-1001` (V-INITECH, 1,600,000 each, APPROVE), `INV-10422` (V-GLOBEX, 2026-10-03, 240,000, servicePeriod `2026-10`, APPROVE). Tax IDs: any unique `NN-NNNNNNN`.

`fixtures/scenarios.ts` exports `SCENARIOS: Scenario[]`:
```ts
export interface Scenario { id: string; tag: string; title: string; file: string; kind: "digital" | "scanned";
  envelope: InboxEnvelope; expected: { outcome: Outcome; rules: RuleId[] }; launcher: boolean; // launcher: Happy, EC-1..EC-5, PV
  truth: { documentType: DocumentType; invoiceNumber: string | null; totalCents: Cents | null; poNumber: string | null; vendorName: string | null; lineCount: number } }
```
| id | tag | file | kind | invoice facts | expected outcome · rules (must include) |
|---|---|---|---|---|---|
| happy | Happy | acme-AC-5531.pdf | digital | AC-5531, PO-2031, exact PO lines, tax 8.25% = 9,569¢, total 125,559¢ | APPROVE · [] |
| ec1 | EC-1 | initech-INI-1101.pdf | digital | 140 h × 12,500 = 1,750,000, no tax | HOLD · [R-PO-03] |
| ec2 | EC-2 | stark-SIP-7781-scan.pdf | scanned | no PO ref; PO-2077 lines exactly; tax 8.25% | APPROVE · [R-PO-02] |
| ec3a | EC-3a | globex-INV10422-R.pdf | digital | INV10422-R, 2026-11-12, period 2026-10, PO-2063, 240,000 | REJECT · [R-DUP-01] |
| ec3b | EC-3b | globex-INV-10587.pdf | digital | INV-10587, 2026-11-05, period 2026-11, PO-2063, 240,000 | APPROVE · [] |
| ec4 | EC-4 | globex-INV-10601.pdf | digital | PO-2064 exact, 987,000; bank 121000248-9930017731; sender `billing@globex-billing.co` | HOLD · [R-VEN-02, R-VEN-03] |
| ec5 | EC-5 | soylent-SC-2219.pdf | digital | PO-2090 lines (sum 734,000) but printed subtotal & total $7,430.00 | HOLD · [R-EXT-02] |
| pv | PV | umbrella-UP-4410.pdf | digital | 40 × $26.05 on PO-2052, tax 8,597¢, total 112,797¢ | HOLD · [R-TOL-01] |
| stmt | Bonus | acme-statement-oct.pdf | digital | statement of account | REJECT · [R-DOC-02] |
| credit | Bonus | acme-credit-CN-112.pdf | digital | credit note | HOLD · [R-DOC-02] |
| billto | Bonus | acme-AC-5540-billto.pdf | digital | billed to "Northwind Logistics GmbH" | HOLD · [R-DOC-03] |
| unknown | Bonus | wayne-WE-001.pdf | digital | vendor "Wayne Enterprises" | HOLD · [R-VEN-01] |
| bundled | Bonus | pixel-PX-0412.pdf | digital | one line "Website refresh — project deliverable" $3,500.00, PO-2095, no tax | APPROVE · [R-BUN-01] |
| taxincl | Bonus | acme-AC-5560-taxincl.pdf | digital | PO-2033 lines with tax-inclusive unit prices $46.01 / $20.56 / $25.98 (×1.0825, rounded), "Prices include 8.25% sales tax: $95.80", total $1,255.70 | APPROVE · [] |
| freight | Bonus | acme-AC-5571-freight.pdf | digital | PO-2034 exact + "Shipping & handling" $45.00, tax 8.25% on goods | APPROVE · [R-FRT-01] |
| nogrn | Bonus | umbrella-UP-4502.pdf | digital | PO-2058 exact, tax 8.25% | HOLD · [R-GRN-02] |
| closedpo | Bonus | stark-SIP-7702.pdf | digital | references PO-2019 | HOLD · [R-PO-04] |
| blocked | Bonus | vandelay-VI-3301.pdf | digital | vendor Vandelay Imports | HOLD · [R-VEN-04] |
| inr | Bonus | bharat-BOS-2026-118.pdf | digital | "Bharat Office Solutions Pvt Ltd", GSTIN, CGST 9% + SGST 9%, currency INR ₹ | HOLD · [R-CUR-01, R-VEN-01] |
| missing | Bonus | soylent-nofields.pdf | digital | PO-2090 lines and totals correct but **no invoice number and no date** printed | HOLD · [R-EXT-01] |
| guide | Bonus | zamp-candidate-guide.pdf | digital | the real `ASA Case Study — Candidate Guide.pdf`, copied (not generated) | REJECT · [R-DOC-02] |

All non-EC-4 senders use the vendor's own domain (e.g. `ap@acmeoffice.com`; `guide` arrives from `hiring@zamp.ai` with subject "ASA Case Study — Candidate Guide"). Bill-to on all except `billto` and `guide` = "Northwind Labs, Inc.".

`fixtures/brief-coverage.ts` exports `BRIEF_COVERAGE: { brief: string; handledBy: string; scenarioIds: string[] }[]` — exactly the 15 rows of spec §6b, with scenario ids from the table above. Rendered by the Assumptions tab (Task 20).

- [ ] **Step 1: Write failing tests** (`tests/fixtures/seed-data.test.ts`): every PO's `totalCents === Σ qty×unit`; `PO-2041.totalCents === 4_800_000`; `PO-2090.totalCents === 734_000`; `PO-2095.totalCents === 350_000`; `PO-2019.status === "closed"`; no GRN references PO-2058; `SCENARIOS.length === 21`; every scenario `file` is unique; every `expected.rules` entry is a valid `RuleId`; every PO references an existing vendor; `BRIEF_COVERAGE.length === 15` and every `scenarioIds` entry exists in `SCENARIOS`; exactly 8 scenarios have `launcher: true`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the six files. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(domain): types, default policy, seed data, scenario manifest`.

### Task 4: Fixture PDF generator

**Files:**
- Create: `fixtures/templates/{classic,modern,minimal,statement,credit}.html`, `scripts/generate-fixtures.ts`
- Test: `tests/fixtures/pdfs.test.ts`

**Interfaces:** Consumes `SCENARIOS`, seed data. Produces `fixtures/pdfs/<scenario.file>` for every scenario.

- [ ] **Step 1:** `npm i -D playwright sharp unpdf` (unpdf also used at runtime → move to dependencies), `npx playwright install chromium`.
- [ ] **Step 2: Write failing test:** for every scenario, file exists; `extractText` (unpdf) on `kind: "digital"` files returns text containing the invoice number (or "STATEMENT"/"CREDIT NOTE"); on `kind: "scanned"` returns < 20 non-whitespace chars.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement `scripts/generate-fixtures.ts`: render a template per scenario with simple `{{placeholder}}` substitution (three invoice layouts rotated across vendors so layouts differ: header position, table style, tax shown separately vs inline); digital → `page.pdf({ format: "Letter" })`; scanned → `page.screenshot` at 150 dpi → `sharp` rotate 1.5°, grayscale, gaussian noise (`sharp().composite` with a generated noise PNG), blur 0.6 → embed PNG into a fresh `pdf-lib` page. Every invoice shows a remittance block with the bank account. EC-5 prints the wrong subtotal/total (`$7,430.00`). EC-2 has no PO reference anywhere. `missing` omits the invoice-number and date rows entirely. `inr` uses an Indian GST layout (GSTIN, HSN column, CGST/SGST rows, ₹). `taxincl` prints only tax-inclusive line prices plus the "Prices include…" note. `guide` is copied byte-for-byte from the repo root PDF, not generated. Also emit `fixtures/pdfs/acme-AC-5531-photo.jpg` (a screenshot of the happy invoice, rotated 3°, for the upload test in Task 16).
- [ ] **Step 5:** Run `npx tsx scripts/generate-fixtures.ts` then tests → PASS. Open 3 PDFs by eye (happy, ec2, ec5) to confirm they look like real invoices.
- [ ] **Step 6:** Commit `feat(fixtures): generated invoice PDFs incl. scans`.

---

## Phase 1 — Pipeline core (Days 2–3)

### Task 5: Text normalisation utilities

**Files:** Create `src/domain/text.ts`; Test `tests/domain/text.test.ts`

**Interfaces — Produces:**
`normalizeForQuote(s: string): string` (lowercase, keep only `[a-z0-9]`); `levenshtein(a: string, b: string): number`; `similarity(a: string, b: string): number` (`1 - lev/maxLen`, 1 for two empty strings); `quoteFound(quote: string, pageText: string, min: number): { found: boolean; score: number }` (normalise both; exact substring → 1; else best sliding window of quote length → similarity); `normalizeInvoiceNumber(s: string): string` (uppercase, keep `[A-Z0-9]`); `tokenJaccard(a: string, b: string): number` (lowercase word tokens, drop tokens of length ≤ 1).

- [ ] **Step 1: Failing tests:**
```ts
expect(quoteFound("$16,000.00", "Amount due 16 000.00 USD", 0.9).found).toBe(true);
expect(quoteFound("Total: $7,430.00", "TOTAL 7430.00", 0.9).found).toBe(true);
expect(quoteFound("$9,999.00", "TOTAL 7430.00", 0.9).found).toBe(false);
expect(normalizeInvoiceNumber("INV-10422")).toBe("INV10422");
expect(similarity("INV10422R", "INV10422")).toBeCloseTo(0.889, 2);
expect(similarity("INV10587", "INV10422")).toBeCloseTo(0.625, 3);
expect(tokenJaccard("Hex bolt M8x40, box of 100", "Hex bolt M8x40 box of 100")).toBe(1);
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `feat(domain): text normalisation + similarity`.

### Task 6: Extraction schema, Gemini extractor, cache, inspect stage

**Files:**
- Create: `src/ai/schema.ts`, `src/ai/prompt.ts`, `src/ai/gemini-extractor.ts`, `src/ai/cached-extractor.ts`, `src/pipeline/stages/inspect.ts`
- Test: `tests/ai/schema.test.ts`, `tests/ai/extractor.test.ts`, `tests/pipeline/inspect.test.ts`

**Interfaces:**
- Consumes: `callWithFallback` (Task 2), `ExtractedInvoice`, `Extractor` (Task 3).
- Produces:
  - `extractionZod` (zod schema mirroring `ExtractedInvoice`; **every key required, every value `.nullable()` where the type allows it; no `min`/`max`/sign constraints on any number**; enums for `documentType` and `lineType`) and `extractionJsonSchema(withBoxes: boolean)` (via `zod-to-json-schema`, `npm i zod zod-to-json-schema`, emitting nullables in the form Task 2 proved works); `coerceNumbers(obj: unknown): unknown` (recursively turns numeric-looking strings like `"1,234.56"`, `"$45.00"`, `"(12.00)"` → `-12` into numbers for the numeric keys only); `parseExtraction(raw: string): { ok: true; value: ExtractedInvoice } | { ok: false; error: string }` = `JSON.parse` → `coerceNumbers` → `extractionZod.safeParse`.
  - `class GeminiExtractor implements Extractor` — `constructor(opts: { keys: string[]; models: string[]; withBoxes: boolean; client?: (key: string) => Pick<GoogleGenAI, "models">; onRetry?: (a: Attempt) => void })`. Sends PDF as `inlineData` + prompt, `responseMimeType: "application/json"`, `responseJsonSchema`. Parse failure counts as `transient` once (one retry), then throws `ExtractionInvalidError`.
  - `class CachedExtractor implements Extractor` — `constructor(inner: Extractor, store: { get(key: string): Promise<ExtractedInvoice & { _model: string } | null>; set(key: string, model: string, v: ExtractedInvoice): Promise<void> })`. Key = `sha256` or `${sha256}:reextract`. `opts.fresh === true` skips the read but still writes; if inner throws `AllProvidersExhaustedError` and a cached value exists → return it with `cached: true` (labelled replay).
  - `fileCacheStore(dir = "fixtures/extractions")` (JSON files, used by eval/bakeoff).
  - `inspect(pdf: Uint8Array): Promise<StageResult<{ sha256: string; pages: number; kind: "digital" | "scanned"; pageTexts: string[] }>>` — `crypto.createHash("sha256")`; `unpdf` `getDocumentProxy` + `extractText(..., { mergePages: false })`; `digital` if avg non-whitespace chars per page ≥ 20. On throw (corrupt/encrypted) → `hits: [{ rule: "R-DOC-04", outcome: "HOLD", facts: { error } }]`, `halt: true`.
- Prompt (`src/ai/prompt.ts`) must state: extract only what is printed; `null` + low confidence when absent — never infer totals; `quote` = verbatim text as printed; `page` 1-based; amounts as decimal numbers, **negative for credits and discounts**; a lump-sum line has `quantity: null, unitPrice: null`; `lineType` per line (tax shown as a line → `tax`; shipping/delivery/handling → `freight`); `taxInclusive` true only if the document says prices include tax; `currency` as ISO code (`USD`, `INR`, `EUR`…), null if not determinable; `servicePeriod` as `YYYY-MM` only if a billing period is printed; `documentType` classification rules with a ≤ 12-word `documentTypeReason`; when `withBoxes`, `box` = `[ymin,xmin,ymax,xmax]` normalised 0–1000 on that page. Re-extract prompt adds: "A previous read did not reconcile: {reason}. Re-read every line amount, the subtotal, tax and total digit by digit."

- [ ] **Step 1: Failing tests:**
  - schema: a hand-written valid JSON for `happy` parses; **a line with `quantity: null, unitPrice: null, amount: 3500` parses**; **a discount line with `amount: -25` parses**; `total: "1,255.59"` (string) parses to `1255.59`; `invoiceNumber: { value: null, … }` parses; `documentType: "purchase_order"` parses; `documentType: "banana"` → `ok: false`; non-JSON string → `ok: false`.
  - extractor (fake client): returns valid JSON → `result.model === "m1"`; returns invalid JSON twice → rejects `ExtractionInvalidError`; client 429 on key0 → result from key1.
  - cached extractor: second call with same sha → inner called once, `cached: true`; `fresh: true` → inner called again; inner throws `AllProvidersExhaustedError` with cache present → returns cached.
  - inspect: `fixtures/pdfs/acme-AC-5531.pdf` → `kind: "digital"`, `pages: 1`, 64-hex sha; `stark-SIP-7781-scan.pdf` → `kind: "scanned"`; `new Uint8Array([1,2,3])` → hit `R-DOC-04`, `halt: true`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement all five files. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ai): extraction schema, gemini extractor, cache, inspect stage`.

### Task 7: Validate stage

**Files:** Create `src/pipeline/stages/validate.ts`; Test `tests/pipeline/validate.test.ts`

**Interfaces — Produces:**
`validate(x: ExtractedInvoice, ctx: { pageTexts: string[]; kind: "digital" | "scanned"; company: { name: string; aliases: string[] }; policy: Policy }): StageResult<{ quoteChecks: { field: string; found: boolean; score: number }[]; arithmeticOk: boolean; arithmeticReason: string | null; netLines: NetLine[]; taxCents: Cents; currency: string }>`

Rules, in order (halt after the first halting one):
1. `documentType` ∈ {`statement`, `purchase_order`, `quote`, `receipt`, `other`} → R-DOC-02 REJECT, halt, `facts: { documentType, reason: documentTypeReason }`; `credit_note` → R-DOC-02 HOLD, halt.
2. Bill-to: if `billTo.value` present and `max(tokenJaccard(billTo, name|alias)) < 0.6` → R-DOC-03 HOLD (no halt).
3. Currency: `currency.value` null → `info` finding "Currency not stated — assumed USD"; `≠ "USD"` → R-CUR-01 HOLD (no halt), `facts: { currency }`.
4. Required: `invoiceNumber`, `invoiceDate` (must parse as ISO date), `vendorName`, `total` non-null → else R-EXT-01 HOLD, halt, `facts.missing = "invoice number, invoice date"`.
5. Resolve lines → `NetLine[]` (skip `lineType: "tax"` lines; add their amounts to tax): `amount` null and `quantity`, `unitPrice` present → `amount = quantity × unitPrice`; `quantity` null → `1`, `unit = amount`; `amount` still null → R-EXT-01 HOLD, halt, `facts.missing = "amount for line N"`. `lineType` null → infer `freight` if description matches `/freight|shipping|delivery|postage|handling/i`, `discount` if amount < 0, else `goods`.
6. Tax basis (`taxCents` = `taxTotal` or Σ tax-type lines, 0 if none):
   - `taxInclusive === true`: `taxCents === 0` → R-TAX-01 HOLD `facts.reason = "Prices include tax but no tax amount is shown"`; else `netFactor = (Σ amounts − tax) / Σ amounts` and every NetLine's `unitCents`/`amountCents` × `netFactor` (rounded).
   - implied rate `tax / (Σ net amounts)` outside `[0, policy.maxTaxRate]` → R-TAX-01 HOLD `facts: { rate }`.
7. Quotes (digital only): check every non-null header field quote and line quote against its page text; a miss → `warn` finding (not a rule).
8. Arithmetic in cents with tolerance `±1¢ × max(1, lines.length)`: `Σ line amounts` (as printed) vs `subtotal` — when subtotal null, compare to `total − tax`; exclusive: `subtotal + tax` vs `total`; inclusive: `Σ lines` vs `total`. Fail → `arithmeticOk: false`, `arithmeticReason` e.g. `"Line items sum to $7,340.00 but the invoice states $7,430.00"`, **no hit yet** (the orchestrator decides re-extract → R-EXT-02).

- [ ] **Step 1: Failing tests** (build `ExtractedInvoice` objects with a small `makeInvoice(overrides)` helper in `tests/helpers/make-invoice.ts`, defaulting to the `happy` scenario values):
  - happy → no hits, `arithmeticOk: true`.
  - EC-5 values (lines 592,000 + 118,000 + 24,000; subtotal 7430.00; total 7430.00; tax 0) → `arithmeticOk: false`, reason contains `"$7,340.00"` and `"$7,430.00"`.
  - `documentType: "statement"` → hit `R-DOC-02` outcome `REJECT`, `halt: true`; `"other"` with reason `"Hiring case-study guide, not a bill"` → REJECT and `facts.reason` carries it; `credit_note` → outcome `HOLD`.
  - billTo `"Northwind Logistics GmbH"` → `R-DOC-03`; billTo `"NORTHWIND LABS INC"` → no hit.
  - currency `"INR"` → `R-CUR-01`, no halt (later stages still run); currency null → `info` finding, no hit.
  - total null → `R-EXT-01` with `facts.missing` containing `"total"`; invoiceNumber and invoiceDate null → `facts.missing` contains both.
  - lump-sum line `{ quantity: null, unitPrice: null, amount: 3500 }` → NetLine `quantity 1, unitCents 350000`, no hit.
  - line with all three values null → R-EXT-01 `facts.missing` `"amount for line 1"`.
  - discount line amount −25 → NetLine `lineType "discount"`, arithmetic still reconciles when subtotal reflects it.
  - **tax-inclusive** (`taxincl` values: unit prices 46.01/20.56/25.98, amounts 920.20/205.60/129.90, taxTotal 95.80, total 1255.70, `taxInclusive: true`) → no hits; NetLine unit cents within 1¢ of 4250/1899/2400.
  - tax-inclusive with taxTotal null → `R-TAX-01`; exclusive with tax 300.00 on subtotal 1000.00 (30%) → `R-TAX-01`.
  - 9 lines each rounded by 1¢ → arithmetic still OK (per-line tolerance).
  - a line with `lineType: "tax"` amount 95.69 is excluded from NetLines and counted in `taxCents`.
  - digital quote `"$9,999.00"` not on page → a `warn` finding, no hit.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS → **Step 5:** Commit `feat(pipeline): validate stage`.

### Task 8: Vendor stage

**Files:** Create `src/pipeline/stages/vendor.ts`; Test `tests/pipeline/vendor.test.ts`

**Interfaces — Produces:** `vendorCheck(x: ExtractedInvoice, vendors: Vendor[], envelope: InboxEnvelope | null): StageResult<{ vendor: Vendor | null; matchedBy: "taxId" | "name" | null }>`

Resolve: exact `taxId` (digits only) → else best `max(tokenJaccard(name, legalName|alias)) ≥ 0.6`. None → R-VEN-01 HOLD, halt. Found but `status ≠ "approved"` → R-VEN-04 HOLD, halt, `facts: { status }`. Bank: compare digits-only of `bankAccount.value` with vendor's; differ → R-VEN-02 HOLD, `facts: { invoiceLast4, masterLast4 }`. Missing bank on invoice → `info` finding only. Sender: if `envelope`, domain after `@` (lowercased) `!== vendor.emailDomain` and not a subdomain of it → R-VEN-03 HOLD, `facts: { senderDomain, expectedDomain }`; no envelope → `info` finding "Sender check n/a (uploaded)".

- [ ] **Step 1: Failing tests:** happy → `vendor.id === "V-ACME"`, no hits; EC-4 (bank `121000248-9930017731`, from `billing@globex-billing.co`) → hits `R-VEN-02` (facts `invoiceLast4: "7731"`, `masterLast4: "0492"`) and `R-VEN-03`; `ap@mail.globex.com` → no R-VEN-03; "Wayne Enterprises" → `R-VEN-01`, halt; Vandelay → `R-VEN-04` with `facts.status === "blocked"`, halt.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(pipeline): vendor stage`.

### Task 9: PO lookup stage

**Files:** Create `src/pipeline/stages/po.ts`; Test `tests/pipeline/po.test.ts`

**Interfaces — Produces:** `poLookup(x: ExtractedInvoice, lines: NetLine[], vendor: Vendor, getPo: (n: string) => PurchaseOrder | null, openPos: PurchaseOrder[], policy: Policy): StageResult<{ po: PurchaseOrder | null; inferred: boolean; candidates: { poNumber: string; score: number }[] }>` — scoring uses `lines` excluding `freight`/`discount` types; `invoiceSubtotalCents` = Σ their `amountCents`.

Explicit `poNumber.value` (normalised `[A-Z0-9-]`, uppercase) found: belongs to another vendor → R-PO-01 HOLD, halt, `facts.reason = "PO-xxxx belongs to <vendor>"`; status `closed`/`cancelled` → R-PO-04 HOLD, halt, `facts: { poNumber, status }`; otherwise use it. No explicit ref (or ref not found) → score each **open** PO:
```
lineScore = (# invoice lines whose best tokenJaccard vs any PO line ≥ 0.5) / (# invoice lines)
amountFit = invoiceSubtotalCents ≤ (po.totalCents − po.billedToDateCents) × (1 + policy.priceTolPct) ? 1 : 0
score     = round2(0.7 × lineScore + 0.3 × amountFit)
```
Winner iff `top ≥ 0.75` and `top − second ≥ 0.15` → `inferred: true`, R-PO-02 NOTE `facts: { poNumber, score }`. Otherwise R-PO-01 HOLD, halt, `facts.candidates = "PO-2077, PO-2081"` (or `"none"`). (Currency is checked in `validate`, not here.)

- [ ] **Step 1: Failing tests:** happy → `po.poNumber === "PO-2031"`, `inferred: false`; EC-2 lines with no PO → `PO-2077`, `inferred: true`, score `1`, R-PO-02 NOTE; two identical open POs for the vendor → R-PO-01 halt with both numbers in facts; explicit `PO-9999` unknown and no line overlap → R-PO-01; explicit `PO-2019` (closed) → R-PO-04 halt; Acme invoice citing `PO-2041` (Initech's) → R-PO-01 with "belongs to" reason.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(pipeline): PO lookup with deterministic inference`.

### Task 10: Match stage (2-/3-way, tolerances, cumulative)

**Files:** Create `src/pipeline/stages/match.ts`; Test `tests/pipeline/match.test.ts`

**Interfaces — Produces:**
```ts
export interface LineMatch { invoiceLine: number; poLineNo: number | null; poUnitCents: Cents | null; invUnitCents: Cents;
  qty: number; priceVarPct: number | null; priceVarCents: Cents | null; receivedQty: number | null;
  status: "ok" | "price" | "qty" | "freight" | "discount" | "bundled" | "unmatched" }
export function match(lines: NetLine[], totalCents: Cents, po: PurchaseOrder, grns: GoodsReceipt[], policy: Policy):
  StageResult<{ lines: LineMatch[]; invoiceSubtotalCents: Cents; cumulativeAfterCents: Cents; overrunCents: Cents; overrunPct: number }>
```
All amounts are the pre-tax `NetLine`s from `validate`. Steps:
1. **Map** each NetLine to the PO line with best `tokenJaccard ≥ 0.5` (ties → first; each PO line may be mapped once).
2. **Price** (mapped lines): `priceVarCents = (inv − po unit) × qty`, `priceVarPct = (inv − po)/po`; if `priceVarPct > priceTolPct || priceVarCents > priceTolAbsCents` → R-TOL-01 HOLD `facts: { scope: "line", line, poUnit, invUnit, pct, cents }`; else if `> 0` → R-TOL-02 NOTE. **Invoice total:** `Σ max(0, priceVarCents)` over mapped lines `> priceTolAbsCents` → R-TOL-01 HOLD `facts: { scope: "invoice", cents }` (each line can pass while the total doesn't).
3. **Unmapped lines**, classified in this order:
   - `lineType "freight"` → `amountCents ≤ policy.freightCapCents` → R-FRT-01 NOTE; else R-FRT-01 HOLD `facts: { amount, cap }`.
   - `lineType "discount"` or `amountCents < 0` → `info` finding "Discount −$X — favourable", no rule.
   - Remaining unmapped lines `U` vs PO lines nobody mapped `P` (value = qty × unit): if both non-empty and `|ΣU − ΣP| ≤ ΣP × priceTolPct` **and** `≤ priceTolAbsCents` → R-BUN-01 NOTE `facts: { invoiceLines: n, poLines: "Discovery & design, Build & integration, QA & launch" }`, status `bundled`; for a 3-way PO the `P` lines must also be fully received, else R-GRN-01.
   - Anything else → R-LIN-01 HOLD `facts: { description }` (never tolerated).
4. **Receipts** (3-way only): no GRN at all → R-GRN-02 HOLD `facts: { poNumber }` (skip per-line R-GRN-01); otherwise `qty > Σ received for that line` → R-GRN-01 HOLD (per-invoice check; partial deliveries billed across several invoices are a known limitation — say so in the interview).
5. `invoiceSubtotalCents = Σ amountCents` of all NetLines except freight (lines are the trusted basis; printed subtotal mismatches are validate's job). Cumulative (pre-tax): `cumulativeAfter = po.billedToDateCents + invoiceSubtotalCents`; if `> po.totalCents × (1 + poOverrunPct)` → R-PO-03 HOLD `facts: { poNumber, poTotal, cumulativeAfter, overrunCents, overrunPct, overUnits }` (`overUnits` = over-qty when single-line PO, e.g. `12`). Approval: `totalCents > approvalThresholdCents` → R-APR-01 ROUTE_FOR_APPROVAL.

Tests build NetLines with a `makeNetLines(...)` helper in `tests/helpers/make-invoice.ts`.

- [ ] **Step 1: Failing tests:**
  - happy vs PO-2031 → all `ok`, no HOLD hits.
  - EC-1: 140 × $125.00 vs PO-2041 (billed 3,200,000) → R-PO-03 with `cumulativeAfter: 4_950_000`, `overrunCents: 150_000`, `overrunPct ≈ 0.03125`, `overUnits: 12`; no R-TOL-01.
  - PV at default policy → R-TOL-01 with `pct ≈ 0.042`, `cents: 4200`.
  - PV with `{ ...DEFAULT_POLICY, priceTolPct: 0.05 }` → no R-TOL-01, has R-TOL-02 NOTE.
  - PV with `priceTolPct: 0.05, priceTolAbsCents: 4000` → R-TOL-01 (absolute limit still binds).
  - EC-1 with `priceTolPct: 0.05` → **still** R-PO-03 (separate knob).
  - invoice with an extra goods line "Laptop stand" not on the PO → R-LIN-01.
  - PO-2034 + freight line "Shipping & handling" 4,500¢ → R-FRT-01 NOTE, no R-LIN-01; same at 12,000¢ → R-FRT-01 HOLD.
  - discount line −2,500¢ → no hits, an `info` finding.
  - **bundled:** single line 350,000¢ (lump sum) vs PO-2095 (2-way) → R-BUN-01 NOTE, no R-LIN-01, no HOLD; same line at 380,000¢ → R-LIN-01 HOLD (outside tolerance → not treated as bundled).
  - 3-way: billed 25 when 20 received → R-GRN-01; PO-2058 with no GRNs → R-GRN-02 and no R-GRN-01.
  - **invoice-total tolerance:** 3 lines each +$20.00 over PO (each within $50) → R-TOL-01 `scope: "invoice"`, cents 6000.
  - total 2,600,000¢ clean → R-APR-01 ROUTE_FOR_APPROVAL.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(pipeline): 3-way match, separate price and PO-overrun tolerances`.

### Task 11: Duplicate stage

**Files:** Create `src/pipeline/stages/duplicate.ts`; Test `tests/pipeline/duplicate.test.ts`

**Interfaces — Produces:** `duplicateCheck(x: ExtractedInvoice, vendorId: string, priors: PriorInvoice[], policy: Policy): StageResult<{ best: { invoiceId: string; invoiceNumber: string; score: number; recurringGuard: boolean } | null }>`

Candidates: same vendor, `|date diff| ≤ dupWindowDays`. Score:
```
if normalizeInvoiceNumber equal → 1
else 0.4·similarity(normInvNo) + 0.3·(|Δamount| ≤ 1% ? 1 : 0) + 0.2·lineOverlap + 0.1·max(0, 1 − |Δdays|/dupWindowDays)
lineOverlap = share of invoice line descriptions with tokenJaccard ≥ 0.8 to some prior line description
recurring guard: both servicePeriod non-null and different → score 0, recurringGuard = true (record as info finding)
```
`≥ dupRejectScore` → R-DUP-01 REJECT `facts: { original, score }`; `≥ dupHoldScore` → R-DUP-02 HOLD.

- [ ] **Step 1: Failing tests:** EC-3a (`INV10422-R`, 2026-11-12, same lines, 240,000, period 2026-10) vs prior `INV-10422` (2026-10-03, 40 days earlier) → R-DUP-01, score `≈ 0.911` (±0.01); EC-3b (`INV-10587`, 2026-11-05, period 2026-11) → no hit, `recurringGuard: true`, and an `info` finding mentioning "different service period"; EC-3b with `servicePeriod` null on both → R-DUP-02 (proves the guard is what saves it); different vendor → no candidates.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(pipeline): fuzzy duplicate detection with recurring guard`.

### Task 12: Decide + explanation templates

**Files:** Create `src/pipeline/stages/decide.ts`, `src/templates/explain.ts`; Test `tests/pipeline/decide.test.ts`

**Interfaces — Produces:**
`decide(hits: RuleHit[], ctx: { policy: Policy; vendor: Vendor | null; invoiceNumber: string | null; totalCents: Cents | null }): Decision` — outcome by precedence; `primary` = first hit of the winning outcome in this priority order: `R-DOC-01, R-DUP-01, R-DOC-02, R-DOC-04, R-VEN-02, R-VEN-03, R-VEN-04, R-VEN-01, R-EXT-01, R-EXT-02, R-TAX-01, R-DOC-03, R-CUR-01, R-PO-04, R-PO-01, R-PO-03, R-LIN-01, R-TOL-01, R-FRT-01, R-GRN-02, R-GRN-01, R-DUP-02, R-APR-01` (NOTE-only hits — R-PO-02, R-TOL-02, R-BUN-01, R-FRT-01 as note — never become primary); `owner = policy.owners[primary.rule]`; `paymentBlocked` = any of R-VEN-02/R-VEN-03/R-VEN-04; `fraudSignals` = count of R-VEN-02, R-VEN-03 present; NOTE hits never change outcome but appear in `reasons`.
`explain(rule: RuleId, facts: RuleHit["facts"]): { reason: string; question: string | null }` and `draftEmail(decision: Decision, vendor: Vendor | null, invoiceNumber: string | null): DraftEmail | null` (drafted for HOLD/REJECT where the vendor must act: R-EXT-01, R-EXT-02, R-DOC-04, R-LIN-01, R-PO-03, R-DUP-01; `to = vendor.contactOnFile`).

Exact copy the spec fixes (use `formatUsd`/`formatPct`):
- R-PO-03 question: `This invoice would bring total billing on {poNumber} to {cumulativeAfter} — {overUnits} hours / {overrunCents} ({overrunPct}) over the PO. Approve a PO amendment, or ask the vendor to re-bill within the remaining {remainingUnits} hours?` (when `overUnits` absent, drop the hours fragments).
- R-VEN-02 reason: `Bank details don't match our records (invoice ••{invoiceLast4}, on file ••{masterLast4}).` question: `Verify by calling the contact already on file — not the number on this invoice — before paying.`
- R-VEN-03 reason: `Sent from {senderDomain}, but this vendor's domain on file is {expectedDomain}.`
- R-EXT-02 question: `{arithmeticReason}. Confirm the correct amount with the vendor?`
- R-TOL-01 reason: `Unit price {invUnit} vs PO {poUnit} (+{pct}, {cents}) exceeds the {tolPct} / {tolAbs} price tolerance.`
- R-DUP-01 reason: `Probable duplicate of {original} (match score {score}).`
- R-DOC-02 reason: `This isn't a payable invoice — it looks like a {documentType}: {reason}.` (credit note: `Credit note — apply it against the vendor's balance instead of paying.`)
- R-BUN-01 reason: `{invoiceLines} bundled invoice line(s) match the PO's {poLines} at the total level.`
- R-FRT-01 reason: note `Freight {amount} accepted (within the {cap} freight allowance).`; hold `Freight {amount} is above the {cap} freight allowance.`
- R-GRN-02 question: `Has this delivery arrived? No goods receipt is recorded against {poNumber} yet.`
- R-PO-04 reason: `{poNumber} is {status} — it can't be billed against.`
- R-VEN-04 reason: `This vendor is {status} in our records — payment blocked until it's reinstated.`
- R-TAX-01 reason: `{reason}` or `Tax of {rate} looks wrong for this invoice.`
- Others: one plain-English sentence each, ≤ 20 words, no rule jargon.
- `summary` = outcome headline: `Approved — touchless` | `Sent for approval — {owner}` | `Held — {primary reason short}` | `Rejected — {primary reason short}`; when `fraudSignals ≥ 2` prefix `2 fraud signals · high risk — `.

- [ ] **Step 1: Failing tests:** no hits → APPROVE, summary `"Approved — touchless"`; [R-TOL-02 NOTE] → APPROVE with 1 reason; [R-APR-01, R-TOL-02] → ROUTE_FOR_APPROVAL owner `Approver`; [R-PO-03 (EC-1 facts)] → HOLD owner `Procurement`, question equals the exact EC-1 string with `$49,500.00`, `12 hours`, `$1,500.00`, `3.1%`, `128 hours`; [R-VEN-02, R-VEN-03] → `paymentBlocked: true`, `fraudSignals: 2`, owner `Treasury`, summary starts with `"2 fraud signals · high risk"`; [R-DUP-01, R-VEN-02] → REJECT; [R-EXT-02] → email drafted to vendor contact; [R-VEN-04] → `paymentBlocked: true`, `fraudSignals: 0`; [R-BUN-01 NOTE, R-FRT-01 NOTE] → APPROVE with 2 reasons; [R-FRT-01 HOLD] → HOLD owner `Procurement`; [R-CUR-01, R-VEN-01] → primary `R-VEN-01`, both in `reasons`; every `RuleId` has an `explain` entry (iterate the union, assert non-empty reason).
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit `feat(pipeline): decision precedence and templated explanations`.

### Task 13: Orchestrator, in-memory repo, ledger read-back, eval

**Files:**
- Create: `src/pipeline/run-pipeline.ts`, `src/db/memory-repo.ts`, `scripts/eval.ts`, `src/pipeline/eval.ts`
- Test: `tests/pipeline/run-pipeline.test.ts`

**Interfaces:**
- Consumes: all stages, `Extractor`, `Repo`, `Emit`.
- Produces:
```ts
export interface RunInput { documentId: string; pdf: Uint8Array; envelope: InboxEnvelope | null;
  source: "inbox" | "upload" | "rerun"; rerunOf?: string; fresh?: boolean }
export async function runPipeline(input: RunInput, deps: { repo: Repo; extractor: Extractor; emit: Emit;
  company: { name: string; aliases: string[] }; now?: () => Date }): Promise<{ runId: string; decision: Decision | null; failed: boolean }>;
export class MemoryRepo implements Repo { constructor(seed?: SeedData); reset(): void; setPolicy(p: Partial<Policy>): void }
  // deep-clones seed (default: fixtures/seed-data); reset() restores; setPolicy bumps version
export async function runEval(opts: { extractor: Extractor }): Promise<{ id: string; expected: Outcome; actual: Outcome | "FAILED"; rulesOk: boolean; pass: boolean }[]>;
```
Orchestration: `createRun` → emit `intake started/completed` → inspect (halt → decide) → R-DOC-01 check via `findAcceptedInvoiceByHash` **skipped when `source === "rerun"`** → extract (emit `retrying` from `onRetry`; `ExtractionInvalidError` → R-EXT-01; `AllProvidersExhaustedError` → emit `failed` + terminal `done` with `failed: true`, `finishRun(FAILED)`) → validate; if `!arithmeticOk` → re-extract once (`reextract.reason`) and re-validate; still failing → R-EXT-02 hit → vendor → po (`validate`'s `netLines`) → match (`netLines`, `toCents(total)`) → duplicate → decide → act: always `saveInvoiceResult`; **only if outcome APPROVE** `postToLedger` then `readBackLedger` (ROUTE_FOR_APPROVAL waits for sign-off — Task 20 calls the same exported `postAndVerify(repo, poNumber, invoiceId, amountCents)` helper) — mismatch (`after !== before + subtotal` or `!invoicePosted`) → emit `failed` "Ledger read-back mismatch", `finishRun(FAILED)`; match → finding `Ledger write verified: {po} {before} → {after}`. Every stage: `started` → findings → `completed` with `durationMs`. Halting stages jump straight to decide. Wrap `emit` in try/catch — emitter errors never abort the run. Persist every event via `repo.appendEvent` (also try/catch-logged). Final `decision` event then `done`.

`scripts/eval.ts`: builds `CachedExtractor(GeminiExtractor, fileCacheStore())`, runs `runEval`, prints a table, exits 1 on any fail. `--fresh` re-extracts.

- [ ] **Step 1: Failing tests** (fake extractor returning per-sha fixtures from a map built with `makeInvoice` for each scenario; `MemoryRepo` with seed):
  - each of the 21 scenarios in `SCENARIOS` → `decision.outcome === expected.outcome` and `expected.rules ⊆ decision.hits.map(h=>h.rule)` (parametrised `it.each`; the fake extractor's map has a `makeInvoice` fixture per scenario, mirroring the PDF content in Task 3's table).
  - `inr` → hits include both `R-CUR-01` and `R-VEN-01` (currency reported even though the vendor stage halts).
  - `freight` approved → ledger posts the goods subtotal only (freight excluded): `PO-2034 $0.00 → $1,156.00`.
  - happy then happy again (source `upload`, same sha) → second is REJECT R-DOC-01; happy then `source: "rerun"` → APPROVE.
  - PV at default → HOLD; `repo.setPolicy({ priceTolPct: 0.05 })` then rerun → APPROVE.
  - EC-5: extractor called twice (second with `reextract`), final R-EXT-02.
  - happy approve → finding text contains `"Ledger write verified: PO-2031 $0.00 → $1,159.90"`; a ROUTE_FOR_APPROVAL run (total 2,600,000¢ on a clean PO) leaves `billedToDateCents` unchanged; a `MemoryRepo` subclass whose `readBackLedger` returns a wrong amount → `failed: true`, last event type `done`.
  - extractor throws `AllProvidersExhaustedError` → `failed: true`, events end with `failed` then `done`, nothing thrown.
  - `emit` that throws on every call → run still completes with correct decision.
  - event `seq` strictly increasing from 1; every stage reached has exactly one `started` and one `completed|failed`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(pipeline): orchestrator, memory repo, ledger read-back, eval`.

### Task 14: Model bake-off (real Gemini)

**Files:** Create `scripts/bakeoff.ts`; output `fixtures/extractions/*.json`, `docs/bakeoff-report.md`, `docs/bakeoff-boxes.html`

**Interfaces:** Consumes `GeminiExtractor`, `SCENARIOS[].truth`, `runEval`.

- [ ] **Step 1:** Implement `scripts/bakeoff.ts`: for each allowed model in `GEMINI_MODELS` × `withBoxes ∈ {false, true}`, extract every scenario PDF (sequential, 1 s gap); score field accuracy vs `truth` (documentType exact, invoiceNumber exact, totalCents exact, poNumber exact-or-both-null, vendorName tokenJaccard ≥ 0.8 or both null, lineCount exact — `guide` scores documentType only) → % fields correct; record median latency. Box hit-rate on digital PDFs: a box "hits" if the quote's text-item coordinates from pdf.js (`getTextContent` transform → normalised 0–1000) fall inside the box (±15). Write `docs/bakeoff-boxes.html` rendering each scanned page image with boxes drawn, for eyeballing.
- [ ] **Step 2:** Run `npx tsx scripts/bakeoff.ts`. Expected: report table `model | boxes | field accuracy | median ms | box hit-rate`.
- [ ] **Step 3:** Decide and record at the top of the report: model order for `GEMINI_MODELS` (highest accuracy, then lowest latency); `EXTRACT_BOXES=true` only if digital hit-rate ≥ 90%, scanned boxes look right by eye, **and** field accuracy with boxes is not lower than without.
- [ ] **Step 4:** With the chosen config, run `npx tsx scripts/eval.ts --fresh` → writes `fixtures/extractions/*.json`; expected all scenarios PASS. If a scenario fails on real extraction, fix the prompt (Task 6) or the fixture's legibility (Task 4) — not the rules — and re-run.
- [ ] **Step 5:** Commit `chore: model bake-off report, cached extractions, eval green`.

---

## Phase 2 — Persistence & API (Days 3–4)

### Task 15: Drizzle schema, Postgres repo, seed/reset

**Files:**
- Create: `drizzle.config.ts`, `src/db/schema.ts`, `src/db/client.ts`, `src/db/pg-repo.ts`, `src/db/seed.ts`
- Test: `tests/db/pg-repo.test.ts` (skipped unless `TEST_DATABASE_URL`)

**Interfaces:**
- Produces: `class PgRepo implements Repo` (+ `getPolicyVersions()`, `savePolicy(p: Omit<Policy,"version">, actor: string): Promise<Policy>`, `listRuns(filter?: { needsAttention?: boolean })`, `getRun(id)` with events, `listInbox()`, `getDocument(id)`, `saveDocument(bytes, filename)`, `overrideRun(runId, action: "approve" | "reject" | "request_info", reason: string)`, `getCache/setCache`); `seedDatabase(db, { withCache: boolean })` — truncates and loads seed data, scenario PDFs into `documents`, one `inbox_messages` row per scenario, and (if `withCache`) `fixtures/extractions/*.json` into `extraction_cache`.
- Tables (spec §9 + `documents`): `vendors, purchase_orders (lines jsonb), goods_receipts (lines jsonb), documents (id, filename, bytes bytea, sha256, pages, kind), inbox_messages (id, scenario_tag, from, subject, body, received_at, document_id), invoices (id, document_id, vendor_id, po_number, extracted jsonb, total_cents, service_period, outcome, sha256, posted bool), runs (id, document_id, source, rerun_of, outcome, decision jsonb, policy_version, model, cached, duration_ms, started_at), run_events (run_id, seq, stage, type, at, duration_ms, data jsonb; pk run_id+seq), audit_log (id, at, actor, action, entity, before jsonb, after jsonb), policies (version pk, body jsonb, created_at), extraction_cache (key pk, model, body jsonb), upload_chunks (upload_id, idx, bytes bytea, created_at; pk upload_id+idx)`.
- `postToLedger` runs in a transaction: `UPDATE purchase_orders SET billed_to_date_cents = billed_to_date_cents + $amt WHERE po_number = $po RETURNING ...` + `UPDATE invoices SET posted = true` + audit row. Use `drizzle-orm/neon-serverless` with `Pool` (transactions need it; `neonConfig.webSocketConstructor = ws`).

- [ ] **Step 1:** `npm i drizzle-orm @neondatabase/serverless ws` and `npm i -D drizzle-kit @types/ws`. Create Neon project with branches `main` and `dev`; put URLs in `.env.local`.
- [ ] **Step 2: Failing tests (env-gated):** after `seedDatabase` → `getPurchaseOrder("PO-2041").billedToDateCents === 3_200_000`; `postToLedger("PO-2031", id, 115_990)` → `{ beforeCents: 0, afterCents: 115_990 }` and `readBackLedger` agrees; `seedDatabase` again restores 0; `savePolicy` → version increments and an `audit_log` row exists with before/after.
- [ ] **Step 3:** Run `TEST_DATABASE_URL=<dev url> npx vitest run tests/db` → FAIL.
- [ ] **Step 4:** Implement; `npx drizzle-kit generate && npx drizzle-kit migrate`; add script `"db:seed": "tsx src/db/seed.ts"`.
- [ ] **Step 5:** Tests → PASS. **Step 6:** Commit `feat(db): postgres schema, repo, seed/reset with cache preload`.

### Task 16: API routes with SSE

**Files:**
- Create: `src/server/sse.ts`, `src/server/repo-factory.ts`, `src/server/run-service.ts`, `src/server/kpis.ts`, the `src/app/api/**/route.ts` files listed in File Structure
- Test: `tests/server/sse.test.ts`, `tests/server/routes.test.ts`, `tests/server/kpis.test.ts`

**Interfaces — Produces:**
- `encodeSse(e: RunEvent): string` → `event: run\ndata: <json>\n\n`; `parseSseChunk(buffer: string): { events: RunEvent[]; rest: string }` (shared with client).
- `getRepo(): Repo & PgRepo-extras` — `MemoryRepo` when `process.env.REPO === "memory"` (tests), else `PgRepo` singleton.
- `startRunStream(body: { inboxMessageId?: string; documentId?: string; rerunOf?: string; fresh?: boolean }): Response` — resolves the PDF (+ envelope for inbox), builds `CachedExtractor(GeminiExtractor, dbCacheStore)`, starts `runPipeline` as a detached promise, pipes emitted events into a `ReadableStream` (ignore writes after cancel), keeps the function alive with `after()` from `next/server` until the pipeline resolves, closes the stream after `done`.
- Routes:
  - `POST /api/runs` → `startRunStream` (SSE).
  - `GET /api/runs?needsAttention=1` → `{ runs, kpis }`; `GET /api/runs/[id]` → run + events + decision + invoice/PO/GRN snapshot for the comparison table.
  - `POST /api/runs/[id]/override` `{ action: "approve" | "sign_off" | "reject" | "query_sent", reason }` (reason required, ≥ 5 chars, except `sign_off`) → audit row; `approve` and `sign_off` call `postAndVerify` and return the read-back result; returns updated run.
  - `POST /api/documents` — **chunked upload**: raw body = one chunk (≤ 3 MB), headers `x-upload-id` (client UUID), `x-chunk-index`, `x-chunk-count`, `x-filename`. Non-final chunk → store in `upload_chunks`, return `{ received: idx }`. Final chunk → assemble; total > 12 MB → 413 `"File is larger than 12 MB"`; sniff magic bytes: `%PDF` → as-is; JPEG (`FF D8 FF`) / PNG (`89 50 4E 47`) → `wrapImageAsPdf(bytes)` (pdf-lib: one page sized to the image); anything else → 400 `"Please upload a PDF, JPG or PNG"`; store document, delete chunks, return `{ documentId }`. `GET /api/documents/[id]` → PDF bytes. Helper `wrapImageAsPdf(bytes: Uint8Array, kind: "jpg" | "png"): Promise<Uint8Array>` in `src/server/wrap-image.ts`.
  - `GET /api/inbox` → inbox rows with scenario tags. `GET/PUT /api/policy` (PUT validates ranges: pct 0–0.25, abs 0–100000¢). `POST /api/demo/reset` → `seedDatabase(withCache: true)`. `GET /api/eval` → `runEval` with `CachedExtractor` over the DB cache (no network on cache hit) → `{ passed, total, results }`.
- `computeKpis(runs): { processed; straightThroughPct; needsAttentionCount; heldCents; protectedCents; avgSeconds; aiCostUsd: 0; manualBenchmarkUsd: 9.40 }` — straight-through = APPROVE with no override ÷ completed runs; protected = totals of runs with R-DUP-01, R-VEN-02 or R-VEN-03.

- [ ] **Step 1: Failing tests:**
  - sse: encode→parse round-trip of 3 events; parse handles an event split across two chunks.
  - routes (with `REPO=memory`, fake extractor injected via `globalThis.__extractorOverride`): `POST /api/runs {inboxMessageId: <happy>}` stream ends with a `done` event and a `decision` APPROVE; `POST /api/documents` with a `.txt` → 400 body contains `"PDF, JPG or PNG"`; 13 MB in 5 chunks → 413; `fixtures/pdfs/zamp-candidate-guide.pdf` (4.7 MB) in 2 chunks → `{ documentId }` and stored bytes equal the original; `acme-AC-5531-photo.jpg` → `{ documentId }` and stored bytes start with `%PDF`; `PUT /api/policy {priceTolPct: 0.5}` → 400; override without reason → 400.
  - kpis: 4 runs (APPROVE, APPROVE+override, HOLD 125,559¢, REJECT R-DUP-01 240,000¢) → `straightThroughPct 0.25`, `needsAttentionCount 1`, `heldCents 125_559`, `protectedCents 240_000`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5:** Manual: `npm run dev`, `curl -N -X POST localhost:3000/api/runs -H "content-type: application/json" -d "{\"inboxMessageId\":\"<id>\"}"` streams events ending in `done`.
- [ ] **Step 6:** Commit `feat(api): SSE run streaming, documents, inbox, policy, reset, eval`.

---

## Phase 3 — UI (Days 2, 4, 5)

### Task 17: Design system, app shell, clickable mock (Day 2)

**Files:**
- Create: `src/components/shell/{app-shell,nav-rail}.tsx`, `src/components/status-pill.tsx`, `src/components/money.tsx`, `src/components/mono.tsx`, `src/components/ledger-strip.tsx`, `src/components/data-table.tsx`, `src/lib/status.ts`, `src/app/{page,needs-attention/page,vendors/page,aop/page,runs/[id]/page}.tsx` (mock data from `fixtures/mock-runs.ts`), `fixtures/mock-runs.ts`
- Test: `tests/lib/status.test.ts`

**Interfaces — Produces:**
- `STATUS_META: Record<Outcome, { label: string; tone: "emerald" | "blue" | "amber" | "crimson" }>` — labels exactly `Approved & posted`, `Pending sign-off`, `Needs attention`, `Rejected`.
- `<StatusPill outcome size?="sm"|"lg" />` (1px border, 6px dot, no icon); `<Money cents signed? pct? />` (Geist, `tabular-nums`, right-aligned; `signed` renders `+$1,500.00 · +3.1%` when `pct` given); `<Mono>` (Geist Mono, for IDs/rule chips/ms); `<LedgerStrip items: { label: string; value: ReactNode; sub?: string; href?: string }[] />` (`grid-cols-5 divide-x border-b`); `<DataTable>` (36–40px rows, 11px uppercase tracked headers, `divide-y`, optional per-cell `tone: "amber" | "crimson"` tint).
- `<AppShell>`: full-viewport; left `<NavRail>` (white, `border-r`): Bills `/` · Needs attention `/needs-attention` (count badge) · POs & vendors `/vendors` · AOP & controls `/aop`; product name top, Reset demo data bottom.

- [ ] **Step 1:** `npx shadcn@latest init` (neutral base, CSS variables); add: button, badge, table, tabs, tooltip, dialog, sheet, input, slider, separator, skeleton, sonner, dropdown-menu. `npm i lucide-react framer-motion geist`. In `globals.css` define tokens from spec §10 (ink `#0A0A0A/#52525B/#71717A`, surfaces `#FFFFFF/#F7F7F5`, canvas `#F4F4F2`, border `#E4E4E7`, primary `#111827`, four status tones with AA text shades); override shadcn defaults to flat (`--radius` small, no `shadow-*` on surfaces). Fonts via `geist/font/sans` and `geist/font/mono`.
- [ ] **Step 2: Failing test:** `STATUS_META.HOLD.label === "Needs attention"`, `STATUS_META.APPROVE.label === "Approved & posted"`, tones unique across outcomes.
- [ ] **Step 3:** FAIL → implement → PASS.
- [ ] **Step 4:** Build the screens as static mocks per spec §10 using `fixtures/mock-runs.ts` (a recorded EC-4 run's events + decision): Bills (ledger strip, AP Inbox pane, bills table with All / Needs attention tabs, exceptions-by-type hairline list); run workspace split view (45/55, sticky header and footer) in running and completed states via a mock toggle; AOP & controls and POs & vendors tabs.
- [ ] **Step 5:** `npm run dev`; review at 1440×900 against the UI quality bar, then a **cliché sweep**: `grep -rnE "gradient|shadow-(md|lg|xl)|rounded-(xl|2xl)|Sparkles|Bot|purple|indigo|violet" src/` must return nothing outside shadcn's own files. **User reviews the mock** and gives feedback; apply feedback before Task 18.
- [ ] **Step 6:** Commit `feat(ui): design tokens, shell, clickable mock of 3 screens`.

### Task 18: Run workspace (live + replay)

**Files:**
- Create: `src/components/run/{use-reveal-queue.ts,reveal-reducer.ts,run-workspace.tsx,document-canvas.tsx,canvas-toolbar.tsx,box-overlay.tsx,inspector-header.tsx,activity-log.tsx,activity-step.tsx,activity-summary.tsx,decision-banner.tsx,match-grid.tsx,drafted-email-dialog.tsx,audit-trail.tsx,action-bar.tsx}`, `src/lib/actions.ts`, `src/lib/run-stream.ts`, `src/app/runs/live/page.tsx`, `src/app/runs/[id]/page.tsx` (replace mock)
- Test: `tests/run/reveal-reducer.test.ts`, `tests/run/run-stream.test.ts`, `tests/lib/actions.test.ts`

**Interfaces:**
- Consumes: `parseSseChunk`, `GET /api/runs/[id]`, `POST /api/runs`, `STATUS_META`.
- Produces:
  - `revealReducer(state: RevealState, action: { type: "enqueue"; events: RunEvent[] } | { type: "tick"; now: number }): RevealState` where `RevealState = { queue: RunEvent[]; shown: RunEvent[]; lastRevealAt: number; minDwellMs: number }` — on `tick`, reveal the next queued event if `now − lastRevealAt ≥ minDwellMs` **for stage `started` events only**; `finding`/`completed` of the current stage reveal immediately after their `started`. `minDwellMs = 300`.
  - `useRevealQueue(events$, { minDwellMs = 300 })` → `{ shown, currentStage, done }` (rAF/interval driving `tick`).
  - `streamRun(body, onEvents: (e: RunEvent[]) => void, signal?: AbortSignal): Promise<void>` (fetch + `getReader` + `parseSseChunk`).
  - `actionsFor(outcome: Outcome, ctx: { hasDraftEmail: boolean; isDuplicate: boolean }): { id: "approve" | "sign_off" | "query" | "reject" | "override" | "rerun" | "ledger"; label: string; variant: "primary" | "secondary" | "danger"; needsReason: boolean }[]` in `src/lib/actions.ts` — exactly the per-outcome sets in spec §10 Screen 2 footer (labels `Approve & post`, `Sign off & post`, `Send vendor query`, `Reject` / `Reject duplicate` when `isDuplicate`, `Override…`, `Re-run against AOP`, `View ledger entry`).
- Behaviour: `/runs/live?inbox=<id>|document=<id>|rerunOf=<id>` POSTs, streams into the queue, and on the first event `history.replaceState` to `/runs/<runId>`. `/runs/[id]` loads stored events and plays them through the same queue (replay label "Replay"). Layout per spec §10 Screen 2: `RunWorkspace` is `h-screen overflow-hidden`, `grid-cols-[45fr_55fr]` with a hairline `border-r`. **Left — `DocumentCanvas`:** `CanvasToolbar` (`Email envelope ▾` popover with from/subject/body when source is inbox, `Source: digital PDF | scanned PDF`, page `1/N`, zoom −/+) over the PDF on `#F4F4F2`. **Right — inspector**, its own scroll container: sticky `InspectorHeader` (vendor, `<Mono>` invoice #, total as large `<Money>`, `<StatusPill size="lg">` — pill shows a neutral "Processing…" state until the decision); body = `ActivityLog` titled **Agent activity log** — `ActivityStep` rows show the **true** `durationMs` in `<Mono>` (`4 ms`, `cached · 0.02 s`), findings with level dots, a pulsing dot on the active step, expandable evidence (quotes + verified badge, candidates, scores), and a calm amber "Retrying… (quota on key 2 → key 3)" row for `retrying`. On `done`, the log collapses (Framer Motion height animation) into `ActivitySummary` (`10 steps · 2.4 s · gemini-3.6-flash · cached`, click to expand) and reveals, in order: `DecisionBanner` (outcome headline, reasons as plain sentences, rule chips in `<Mono>`, owner, the one question, payment-blocked line when set — flat, hairline-bordered, tinted left edge only), `MatchGrid` (`<DataTable>` columns `Item | Ordered | Received | Billed | Unit price | Variance`; `Received` shows `—` for 2-way; only the breaking cell is tinted, tooltip names the rule), drafted email preview (first 3 lines + "Open"), `AuditTrail`. Sticky `ActionBar` footer renders `actionsFor(...)`; actions needing a reason open a dialog; `Send vendor query` opens `DraftedEmailDialog` (Copy / Mark as sent → `query_sent` override, no real email); `Re-run against AOP` → `/runs/live?rerunOf=<id>`. `PdfPane`: `react-pdf` canvas pages (`renderTextLayer={false}`), clicking any field/line in the extraction list scrolls to its page and shows the quote with a "verified"/"not found on page" badge; when `EXTRACT_BOXES` (exposed via `/api/runs/[id]` `config.boxes`) render `BoxOverlay` divs at `top: ymin/10 %`, `left: xmin/10 %`, `height: (ymax−ymin)/10 %`, `width: (xmax−xmin)/10 %`, skipping boxes out of `[0,1000]` or smaller than 5 units. Email header strip shows from/subject when the source is inbox.

- [ ] **Step 1: Failing tests:** reducer — enqueue 10 events across 3 stages at t=0, tick at t=0 shows stage 1 `started` + its findings + `completed`; tick at t=100 shows nothing new; tick at t=300 shows stage 2; `done` revealed only after all stages. run-stream — mock `fetch` streaming two chunks splitting an event → `onEvents` receives all events in order. actions — `HOLD` → ids `["approve","query","reject","rerun"]` with `approve.needsReason === true`; `ROUTE_FOR_APPROVAL` → `["sign_off","reject"]`; `REJECT` with `isDuplicate` → contains `"override"` and `"rerun"`; `APPROVE` → `["ledger","rerun"]`; `HOLD` without draft email → no `"query"`.
- [ ] **Step 2:** FAIL → **Step 3:** implement reducer/hook/stream → **Step 4:** PASS.
- [ ] **Step 5:** Build the components and pages; run happy, EC-4 and EC-2 from the inbox locally; verify each stage is visibly sequential, true ms badges appear, and the layout swaps on completion.
- [ ] **Step 6:** Commit `feat(ui): live/replay run workspace with paced timeline`.

### Task 19: Dashboard

**Files:**
- Create: `src/components/dashboard/{bills-table,inbox-pane,upload-drop,eval-dialog,exceptions-list}.tsx`; replace mocks in `src/app/page.tsx` and `src/app/needs-attention/page.tsx`
- Test: `tests/dashboard/runs-filter.test.ts`

**Interfaces:** Consumes `GET /api/runs`, `GET /api/inbox`, `POST /api/documents`, `POST /api/demo/reset`, `GET /api/eval`, `<LedgerStrip>`, `<DataTable>`, `<StatusPill>`. Produces `filterRuns(runs, { needsAttention: boolean })` (needsAttention = outcome HOLD and no override, or ROUTE_FOR_APPROVAL not yet signed off).

- [ ] **Step 1: Failing test:** `filterRuns` with `needsAttention` returns un-overridden HOLDs and un-signed ROUTEs only.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Build the **Bills** page (flush layout, hairlines, no cards): `<LedgerStrip>` with exactly five cells — `Processed` (sub: `avg 2.4 s · AI cost $0.00 vs ~$9.40 manual`), `Straight-through rate`, `Needs attention` (count + `$ held`), `Fraud & duplicates blocked` ($), `Eval suite` (`21/21`, crimson when any fail, click → `EvalDialog`); below, a two-region row split by `border-r`: **AP Inbox** pane (rows: from, subject, scenario tag in `<Mono>`, "Process" → `/runs/live?inbox=<id>`; upload drop zone at its top) and **Exceptions by type** (`ExceptionsList`: rule chip, plain label, count, thin monochrome inline bar — plain divs, no chart library); then `BillsTable` (time, `<Mono>` invoice #, vendor, `<Money>` amount, `<StatusPill>`, primary reason, chevron link) with `All` / `Needs attention` tabs. `/needs-attention` renders the same page with the tab preselected; the nav badge shows `needsAttentionCount`. upload drop zone (accepts PDF/JPG/PNG ≤ 12 MB; client splits into 3 MB chunks with a progress bar via `uploadInChunks(file: File): Promise<{ documentId: string }>` in `src/lib/upload.ts`; readable error toasts) → `/runs/live?document=<id>`; Reset demo data in the nav rail (confirm dialog → toast "Demo data restored"). Empty state: "No bills yet — process an email from the AP Inbox." Loading: skeleton rows matching the 40px row height.
- [ ] **Step 4:** Manual: reset → process happy, EC-1, EC-3a, EC-3b, EC-4 → ledger strip and table update; Needs attention shows EC-1 and EC-4 and the nav badge reads 2.
- [ ] **Step 5:** Commit `feat(ui): dashboard with KPIs, inbox launcher, upload, tests badge, reset`.

### Task 20: Settings (AOP), re-run diff banner, overrides

**Files:**
- Create: `src/components/settings/{aop-form,master-data,assumptions}.tsx`, `src/components/run/{rerun-banner,reason-dialog}.tsx`, `src/lib/decision-diff.ts`; replace mocks in `src/app/aop/page.tsx` (tabs: AOP & controls · Assumptions) and `src/app/vendors/page.tsx` (master data)
- Test: `tests/lib/decision-diff.test.ts`

**Interfaces:** Produces `decisionDiff(before: Decision, after: Decision, policyBefore: Policy, policyAfter: Policy): string | null` → e.g. `Decision changed: HOLD → APPROVE — unit-price variance 4.2% now within 5% tolerance` (null when outcome unchanged; reason derived from the rule that disappeared and the policy field that changed).

- [ ] **Step 1: Failing test:** PV decisions (HOLD with R-TOL-01 pct 0.042 → APPROVE) with `priceTolPct` 0.02 → 0.05 → exactly the string above; identical outcomes → `null`.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3:** Tab **AOP & controls** (flush form, hairline-divided sections, no cards) with subtitle `The tolerances, approval matrix and escalation rules the agent runs against every invoice`: sliders + numeric inputs for price tolerance % and $, PO-overrun %, freight cap $, approval threshold, duplicate thresholds; owner per exception type (read-only table); version + "last changed" line; **Save & re-run last invoice** → `PUT /api/policy` then navigate to `/runs/live?rerunOf=<lastRunId>`; on the resulting run page, `RerunBanner` shows `decisionDiff`. **POs & vendors** page: three `<DataTable>`s — vendors (status pill-style label, bank masked `••0492` in `<Mono>`, email domain), POs (`<Mono>` number, vendor, status, total, billed-to-date with a thin monochrome progress bar), GRNs. Tab **Assumptions**: (1) **Brief coverage** table rendered from `BRIEF_COVERAGE` — each row shows the brief sentence, the rule(s), and scenario chips that link to that scenario's latest run (or "Process" if none); (2) static list from spec §8 "Assumptions to record in-app"; (3) spec §3 non-goals and the known limitations (partial deliveries across invoices, multi-PO invoices, quantity tolerance, first-payment checks).
- [ ] **Step 4:** Wire the `ActionBar` actions to `POST /api/runs/[id]/override` via `ReasonDialog` (reason required where `needsReason`). `Approve & post` and `Sign off & post` show the read-back result inline ("Ledger write verified: PO-2052 $0.00 → $1,042.00"); every action appears in the audit trail and the run leaves Needs attention.
- [ ] **Step 5:** Manual: PV → HOLD; change price tolerance to 5% → Save & re-run → APPROVE with the banner; set back to 2%.
- [ ] **Step 6:** Commit `feat(ui): AOP settings, re-run diff banner, overrides`.

---

## Phase 4 — Ship (Days 4–6)

### Task 21: Deploy to Vercel + production smoke test

**Files:** Create `tests/e2e/demo.spec.ts`, `playwright.config.ts`

- [ ] **Step 1:** Push to a private GitHub repo; import into Vercel; set env vars (`GEMINI_API_KEYS`, `GEMINI_MODELS`, `DATABASE_URL` → Neon `main`, `EXTRACT_BOXES`); run migrations + `npm run db:seed` against `main`.
- [ ] **Step 2: Write the e2e test** (`BASE_URL` env): reset demo data; for each scenario tag in launcher order (Happy, EC-1, EC-2, EC-3a, EC-3b, EC-4, EC-5, PV) click Process, wait for the decision card, assert its label equals `STATUS_META[expected.outcome].label`; then the PV policy flip asserts the banner text; upload `zamp-candidate-guide.pdf` asserts "Rejected"; upload `acme-AC-5531-photo.jpg` asserts a decision card appears; upload a `.txt` asserts the error toast.
- [ ] **Step 3:** Run `BASE_URL=https://<app>.vercel.app npx playwright test` → PASS. Run it again immediately (reset makes it repeatable) → PASS.
- [ ] **Step 4:** Commit `chore: vercel deploy + production e2e smoke`.

### Task 22: Resilience & polish pass

**Files:** modify components as needed; Create `docs/demo-runbook.md`

- [ ] **Step 1:** Verify each Review Focus item on the deployed app by hand: launcher twice without reset (second Happy → REJECT duplicate), the Zamp guide upload → Rejected "not an invoice", a phone photo of a printed invoice → processed as a scan, an interviewer-style real SaaS invoice (any PDF receipt from your own email) → graceful HOLD with bill-to / unknown-vendor reasons, corrupt PDF upload (create with `head -c 2000 /dev/urandom > bad.pdf` style bytes prefixed `%PDF`) → HOLD R-DOC-04 card, non-PDF → toast, close tab mid-run then open `/runs/<id>` → full replay, set `GEMINI_API_KEYS` to an invalid key in a Preview deployment with `fresh=1` → visible failed state.
- [ ] **Step 2:** UI quality checklist (spec §10) on every screen at 1440×900 (and at 110% zoom, as recorded): flush hairline panes, no floating cards; status pills and labels identical everywhere; money right-aligned tabular, IDs in mono; only breaking cells tinted; nothing below 13px except 11px column headers; empty/loading/retrying/error states present; sticky header/footer don't jump when the log collapses; cliché grep from Task 17 Step 5 still clean. Dark mode only if everything else is done (it's on the cut line). Fix findings.
- [ ] **Step 3:** Write `docs/demo-runbook.md`: pre-demo checklist (reset, Tests badge green, warm the app by opening it), the run order with one-line narration per scenario (from spec §14), recovery moves (cached toggle, replay), and the interview Q&A from spec §15.
- [ ] **Step 4:** Rehearse the full demo 3× in a row on production; all clean.
- [ ] **Step 5:** Commit `chore: resilience pass, polish, demo runbook`.

---

## Deferred (stretch — only if ahead after Task 22)

EC-2 tie variant (two equally plausible POs → R-PO-01 question); R-SPL-01 invoice-splitting flag; tax-inclusive normalisation scenario; real inbound email.

## Schedule mapping

Day 1: Tasks 1–4 · Day 2: Tasks 5–6, 14 (bake-off can run once Task 13's eval exists — run Step 1–3 on Day 2 with field accuracy only, finish Step 4 on Day 3), 17 · Day 3: Tasks 7–13, 15 · Day 4: Tasks 16, 18, 21 (first deploy) · Day 5: Tasks 19, 20 · Day 6: Task 22 · Day 7: record video, submit.
