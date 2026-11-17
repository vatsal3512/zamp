# Northwind AP — invoice processing, from PDF to decision

An accounts-payable agent for the Zamp AI Solutions Analyst case study (PS-1). An invoice arrives by email or
upload; the agent reads it, checks it against the vendor master, purchase orders and goods receipts, and decides:
**approve and post**, **route for sign-off**, **hold with one specific question**, or **reject**. Every step
streams live to a run view, and every decision can be traced to a rule and the evidence on the page.

**Live demo:** https://zamp-nine.vercel.app (use *Reset demo data* in the left rail to start fresh)

**The core design choice: AI reads, rules decide.** Gemini does one job: turn the document into structured fields,
each with a verbatim quote from the page. A deterministic rules engine (26 rules) makes the decision, and the
explanation, the question and any vendor email are templated from the same rule facts. So the explanation can't
contradict the decision, the same invoice always gets the same answer, and policy changes are configuration, not prompts.

## What it handles

| Scenario | What happens |
|---|---|
| **Happy path** | PO, receipt and prices match; posted to the ledger, and the write is read back to verify it. |
| **EC-1 Split billing overruns the PO** | The second invoice on a PO pushes it 3.1% over, measured at contracted prices. Held for Procurement with the exact overrun and remaining hours. |
| **EC-2 Scanned invoice, no PO number** | No text layer, no PO reference: the PO is inferred from line items and amount, and the invoice is approved with a note. |
| **EC-3a Disguised duplicate** | Same invoice re-sent as "INV10422-R" with a new file: fuzzy duplicate score, rejected and linked to the original. |
| **EC-3b Legitimate monthly repeat** | Same vendor and same amount next month: the service-period guard prevents a false duplicate. Approved. |
| **EC-4 Bank details changed** | Amounts are perfect, but the bank account changed and the email came from a look-alike domain. Payment blocked; Treasury is asked to call the contact on file. |
| **EC-5 Totals don't add up** | Lines don't sum to the stated total: one targeted re-read, then held with a drafted vendor email. Never guessed. |
| **PV Supplier price increase** | 4.2% over a contracted price: held at a 2% tolerance; change the AOP to 5%, re-run, and it approves, with a banner saying why. |

Plus 13 more scenarios: statement, credit note, wrong bill-to, unknown vendor, bundled lines, tax-inclusive prices,
freight, no goods receipt, closed PO, blocked vendor, INR/GST invoice, missing fields, and a document that isn't an invoice.

## How it works

```
intake → inspect → extract (Gemini) → validate → vendor → PO → 3-way match → duplicate → decide → act
```

- **Evidence you can check.** Each extracted field carries a quote that is verified against the PDF text layer.
  Highlights on the document are placed from where that quote sits on the page, not from model-guessed boxes
  (68/68 correct, against 78% for the model's own boxes).
- **Arithmetic reconciliation.** If line items, tax and total don't reconcile, the agent re-reads once with the
  discrepancy named; if it still fails, it holds rather than guesses.
- **Policy as an Agent Operating Procedure (AOP).** Tolerances, thresholds and duplicate scores are versioned
  configuration with an owner per rule. Saving can re-run the last invoice to show the decision change.
- **Resilient extraction.** A key pool rotates free-tier keys and falls back across models; recorded extractions
  replay when every provider is exhausted.
- **Human in the loop where it matters.** Held invoices get one question for one owner (AP, Procurement, Treasury,
  Approver). Overrides need a reason and land in the audit trail. Fraud holds never offer approval as the default action.

## Evidence it works

- **Eval suite: 21/21 scenarios** decided correctly, each firing exactly its expected rules, on fresh Gemini
  extractions (`npx tsx scripts/eval.ts --fresh`), and shown live on the dashboard.
- **Model bake-off** ([docs/bakeoff-report.md](docs/bakeoff-report.md)): four Gemini models on all 21 documents;
  three tie at 100% field accuracy, and the fastest (3.1 Flash-Lite, 4.2 s median) leads.
- **222 unit and integration tests** (`npm test`), including Postgres via PGlite.

## Run it

```bash
npm install
cp .env.example .env.local      # add GEMINI_API_KEYS (comma-separated) and DATABASE_URL
npm run db:migrate && npm run db:seed
npm run dev                      # http://localhost:3000
```

No keys or database? `npm run dev:offline` runs the whole app in memory on recorded fixtures.
`npm run dev:gemini` uses real Gemini with in-memory data.

## Stack

Next.js 16 (App Router, server-sent events for the live run), TypeScript, Tailwind v4, shadcn/Base UI,
react-pdf · Gemini via `@google/genai` with JSON-schema output · Drizzle on Neon Postgres · Vitest, PGlite, Playwright.

## Not built (by design, for scope)

Real ERP and payment rails, multi-PO invoices, partial deliveries across invoices, credit-note application, and
sending email (vendor emails are drafted, never sent). The full list of assumptions is on the AOP page,
under *Assumptions & brief coverage*, which maps each requirement of the brief to the rule and fixture that prove it.

Docs: [design spec](docs/superpowers/specs/2026-11-16-invoice-processing-design.md) ·
[demo runbook](docs/demo-runbook.md) · [bake-off](docs/bakeoff-report.md)
