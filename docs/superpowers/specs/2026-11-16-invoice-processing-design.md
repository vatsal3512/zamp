# PS-1 Invoice Processing — Design & Build Plan

*Zamp ASA case study · drafted 2026-11-16 · revision 4 · status: APPROVED*

**Revision 4 changes (edge-case gap fixes):** bundled lines (R-BUN-01); tax-inclusive
normalisation (R-TAX-01); freight allowance (R-FRT-01); no receipt yet (R-GRN-02); closed PO
(R-PO-04); blocked/inactive vendor split from unknown (R-VEN-04); currency checked against USD
base in Validate; total-level price tolerance; per-line rounding; lenient extraction schema
(nullable line values, negatives allowed, line types, wider document types); image uploads and
chunked uploads up to 12 MB; brief coverage matrix (§6b).

**Revision 3 changes:** separate price vs PO-overrun tolerances; EC-1 re-storied as usage
overrun at contracted rate; dedicated Policy-flip preset (PV); client-side timeline pacing;
field highlighting gated on a Day-2 accuracy test; Policy tab framed as Agent Operating
Procedure (AOP); ledger read-back verification; document-type + bill-to checks; sender-domain
rule R-VEN-03; verified Gemini model IDs + Day-1 smoke test.

**Revision 2 changes:** free-tier LLM stack (Gemini) with 1 AI call per invoice; 8 screens → 3;
EC-5 (broken arithmetic / missing field) added as a launcher preset; quote-verification
normalisation; simulated AP inbox instead of real inbound email; demo-resilience layer expanded.

---

## 0. The one-line pitch

**"AI reads the invoice. Rules make the decision. A human answers one question when it matters."**

An AP agent that takes any invoice PDF (clean, scanned, messy), extracts it with evidence for
every field, matches it against vendor master + PO + goods receipt, and returns one of four
decisions with plain-English reasons — streaming every step live, and leaving a full audit trail.

---

## 1. What the brief actually asks (and how it's graded)

| The brief says | What it means for the build |
|---|---|
| "takes an invoice as input and produces a clear, reasoned decision" | Input = PDF. Output = a decision **plus reasons**, not just extracted fields |
| "with everything that happened in between visible" | **Live run view**: every stage streams as it executes, with inputs/outputs inspectable |
| "Some are scanned images… tax embedded or separated… PO references explicit or implied… info missing" | Extraction must handle scans, tax styles, inferred POs, missing fields — and *say* when it's unsure |
| "approved vendors, PO amounts, tolerance thresholds, duplicate detection rules" | A procurement dataset + a **policy** the process enforces |
| "A vendor might split a single PO into multiple invoices. Amounts close but not exact" | Stateful PO consumption tracking; tolerance logic |
| "2–4 edge cases… don't pick trivial ones" | 4 headline edge cases + 1 robustness preset — each tells a story about AP judgment |
| "The UI is part of the grade… live run view… dashboard (history, status, outputs)" | Exactly these two screens are the heart of the app |
| "explain it clearly to a non-technical buyer" | Decision card in plain English; buyer-language metrics (cost, time, $ protected) |
| "One that breaks live… is hard to recover from" | Demo resilience is a feature: seeded scenarios, reset, cache, retries, fallbacks |
| "Make an assumption, note it somewhere you can reference" | An in-app **Assumptions** tab |

**What most candidates will build:** upload PDF → LLM extracts JSON → compare total to PO →
"approved / mismatch". That's the bar to clear by a wide margin.

---

## 2. How this stands out (the differentiators)

1. **The LLM never decides money.** AI extracts; a deterministic rules engine decides. Every
   decision cites rule IDs (`R-TOL-01: price variance 4.2% > 2% tolerance`). Same input → same
   decision. This is the core design judgment a finance buyer needs to hear.
2. **Explanations can't contradict decisions.** The plain-English reasons, the "one question"
   and the drafted vendor email are generated from the rule results by templates — not by a
   second AI call that could drift.
3. **Evidence for every field.** Each extracted value carries a verbatim source quote, page
   number and confidence. Quotes are machine-verified against the PDF text layer.
4. **The process checks its own work.** Arithmetic self-consistency (lines → subtotal → tax →
   total) catches misreads before matching. One targeted re-extraction on failure; if still
   inconsistent → human, never a guess.
5. **3-way match, not just 2-way.** PO (ordered) vs goods receipt (arrived) vs invoice (billed).
6. **Four outcomes, not two** — mirroring real AP:
   - `APPROVE` — touchless
   - `ROUTE FOR APPROVAL` — clean, but policy needs a signature (e.g. > $25k)
   - `HOLD — EXCEPTION` — names the **owner** (Procurement / Receiving / AP / Treasury) and asks **one specific question**
   - `REJECT` — duplicate or invalid; never pay
7. **Policy is configuration, not code.** Live moment: *"What if tolerance were 5%?"* → change →
   re-run → decision flips, reason updates.
8. **Closes the loop.** Exceptions produce a next action (drafted vendor email / reviewer
   task); reviewer resolves in-app (override-with-reason / reject / request info) → audit trail.
9. **Model-agnostic, measured.** The AI is one swappable component behind a single interface.
   A labeled eval set (~15 invoices with expected decisions) shows "15/15 correct" — the same
   suite would pick a production model.
10. **Buyer-language metrics.** Touchless rate, exceptions by type, $ held, $ fraud blocked,
    avg processing time, cost per invoice vs. manual benchmark (~$9.40/invoice, Ardent Partners).

---

## 3. Goals, non-goals, anti-goals

**Goals**
- Any realistic invoice PDF in → correct, explained decision out, end-to-end, live
- 4 headline edge cases + 1 robustness preset, handled deliberately and demonstrably
- Live run view + dashboard a non-technical person understands in 10 seconds
- A live demo that cannot visibly break
- $0 running cost

**Non-goals** (say so in the interview — knowing what to skip is judgment)
- Real ERP integration (SAP/Oracle/NetSuite) — simulated with Postgres
- Real payments; real email sending/receiving (inbox is simulated, drafts only)
- GL coding / cost-center allocation
- Multi-currency FX conversion (currency is checked, not converted)
- Auth / multi-tenant

**Anti-goals** (failure even if it "works")
- An LLM that approves invoices on vibes — any decision not traceable to a rule
- Silent guessing — inventing a PO match, filling a missing total
- A demo that only works on hand-picked happy inputs
- A UI that shows a JSON blob

---

## 4. The process map

```
1 Intake → 2 Inspect → 3 Extract (AI) → 4 Validate → 5 Vendor → 6 PO lookup → 7 3-way match → 8 Duplicate & fraud → 9 Decide (rules) → 10 Act & explain
```

| # | Stage | What happens | Can end the run early? |
|---|---|---|---|
| 1 | **Intake** | From the simulated **AP Inbox** (email envelope: from, subject, body + PDF attachment) or drag-and-drop upload. Uploads: PDF, JPG or PNG (images wrapped into a one-page PDF), up to **12 MB** via chunked upload (Vercel's 4.5 MB request cap; 12 MB keeps the base64 Gemini request comfortably small). Store PDF, compute SHA-256. Email sender domain kept as context (used by EC-4) | — |
| 2 | **Inspect document** | Page count; text layer present? → `digital` / `scanned`. Exact-file-hash duplicate check | Yes: same file already processed → REJECT |
| 3 | **Extract** | **The one AI call.** Gemini reads the PDF natively (handles scans) and returns JSON matching a **lenient** schema: **`document_type`** (`invoice` / `credit_note` / `statement` / `purchase_order` / `quote` / `receipt` / `other`) + short `document_type_reason`, header, vendor, bill-to, PO ref, dates, currency, line items (each with `line_type`: goods / service / freight / tax / discount / other), tax, totals, remittance bank details. Each field: `value`, `source_quote`, `page`, `confidence` (+ `box_2d` only if enabled after Day-2 test). **Every key is required but every value may be `null`** (incl. line quantity, unit price, amount, and `tax_inclusive`); **no sign or range constraints** (credits and discounts are negative) — meaning is judged in Validate, never by the schema. Numbers sent as text ("1,234.56") are coerced before parsing. Cached by file hash | Yes: not an invoice → R-DOC-02 |
| 4 | **Validate extraction** | **Bill-to entity** matches our company (fuzzy, incl. known aliases) else R-DOC-03; **currency** null → assume USD (info), ≠ USD → R-CUR-01 (checked here so it's reported even when the vendor is unknown); required fields present; line values resolved (amount = qty × unit when missing; lump-sum line → qty 1); **tax basis**: tax-inclusive lines converted to pre-tax using the printed tax amount, implied tax rate must be 0–15%, otherwise R-TAX-01; **quote verification**: normalise both sides (lowercase, strip whitespace, punctuation, currency symbols, thousands separators) then fuzzy-contains (≥ 0.9 similarity) against text layer — digital PDFs only; arithmetic: Σlines = subtotal, subtotal + tax = total (±$0.01 **per line**, so rounding never false-fails; tax-type lines count as tax, not lines); dates sane; tax basis (inclusive/exclusive) identified. Arithmetic fail → one targeted re-extract (2nd AI call, only in this case) | Yes: missing field / still inconsistent → HOLD · AP |
| 5 | **Vendor check** | Resolve vendor (tax ID exact → name fuzzy) against master. Approved? Active? **Bank details on invoice vs. master**; **sender email domain vs. vendor's domain on file** (inbox runs only; "n/a" for uploads) | Yes: unknown vendor → HOLD · Procurement (onboarding) |
| 6 | **PO lookup** | Explicit ref → lookup. No ref → **deterministic candidate scoring** (same vendor, open POs; line-description similarity + amount fit). Clear winner → proceed, flagged "PO inferred (score 0.93)". Tie → HOLD asking *which* PO. Never invent | Yes: none / ambiguous → HOLD · Procurement |
| 7 | **Match (3-way)** | On pre-tax lines. Line level: unit price vs PO (tolerance, per line **and** summed across the invoice), qty billed vs received (GRN; no receipt at all → R-GRN-02), **cumulative billed on PO**. Unmatched invoice lines are classified, in order: **freight** (allowance up to the freight cap, R-FRT-01) → **discount** (favourable, noted) → **bundled** (their sum matches the PO lines nobody billed, within price tolerance → R-BUN-01 note) → otherwise **uncontracted** (R-LIN-01) | — |
| 8 | **Duplicate & fraud** | Fuzzy duplicate: normalised invoice no. (edit distance ≤ 2), same vendor, amount ±1%, 90-day window → score; **recurring guard** (different service period ≠ duplicate). Threshold-splitting signal (stretch) | — |
| 9 | **Decide** | Rules engine → outcome, triggered rule IDs, owner, one question. Precedence: REJECT > HOLD > ROUTE > APPROVE | — |
| 10 | **Act & explain** | Templates render: plain-English summary, the question, drafted vendor email / approver note. If APPROVE → update PO ledger in a transaction (a ROUTE_FOR_APPROVAL invoice is *not* posted until an approver signs off in the workspace; sign-off runs the same post + read-back), then **read-back verification**: re-select the PO row and confirm billed-to-date = previous + invoice amount and the invoice status = posted ("Ledger write verified: PO-2041 $32,000.00 → $49,500.00"). Mismatch → run marked failed, never silently "approved". Write audit log | — |

Every stage emits events (`started`, `finding`, `retrying`, `completed`, duration) over SSE.

**Timeline pacing (client-side, honest):** the server emits events at true speed (stages 4–10
finish in < 50 ms). The run workspace *plays them back* through a reveal queue with a minimum
dwell of ~300 ms per stage, so a viewer can follow each step. Each stage still shows its **true**
duration badge (e.g. `4 ms`), and cached extraction shows `cached · 0.02 s`. No server-side
sleeps — evals and timing claims stay real. Replay of past runs uses the same queue.

---

## 5. Decision rules (policy v1 — editable in-app)

| Rule ID | Check | Default | Outcome if triggered |
|---|---|---|---|
| R-DOC-01 | Exact file already processed | — | REJECT |
| R-DOC-02 | Not a payable invoice: `statement` / `purchase_order` / `quote` / `receipt` / `other` → REJECT ("not payable", with the model's short reason as evidence); `credit_note` → HOLD · AP ("apply against vendor balance" — credit-note processing out of scope) | — | REJECT / HOLD · AP |
| R-DOC-03 | Bill-to entity isn't our company | — | HOLD · AP |
| R-DOC-04 | File can't be read as a PDF (corrupt / encrypted / empty) | — | HOLD · AP (drafted "please resend" email) |
| R-CUR-01 | Invoice currency ≠ USD (our base currency; all POs are USD) | — | HOLD · AP |
| R-EXT-01 | Required field missing (inv no., date, total, vendor) or a line amount can't be determined | — | HOLD · AP |
| R-EXT-02 | Arithmetic doesn't reconcile after re-extract | ±$0.01 per line | HOLD · AP |
| R-TAX-01 | Tax can't be reconciled: tax-inclusive prices with no tax amount printed, or implied tax rate outside 0–15% | 0–15% | HOLD · AP |
| R-VEN-01 | Vendor not in master | — | HOLD · Procurement (route to onboarding) |
| R-VEN-04 | Vendor in master but **blocked / suspended / onboarding** | — | HOLD · Procurement + payment block |
| R-VEN-02 | **Bank details differ from vendor master** | — | HOLD · Treasury + payment block |
| R-VEN-03 | **Sender email domain ≠ vendor's domain on file** (inbox runs only) | exact domain match | HOLD · Treasury; with R-VEN-02 → card shows "2 fraud signals · high risk" |
| R-PO-01 | No PO found / ambiguous / referenced PO belongs to another vendor | — | HOLD · Procurement |
| R-PO-02 | PO inferred (no explicit ref) | — | flag only (note on decision) |
| R-PO-04 | Referenced PO is **closed or cancelled** | — | HOLD · Procurement |
| R-TOL-01 | **Unit-price** variance vs PO (contracted lines only), per line **or** summed over the invoice | > 2% **or** > $50 (*price tolerance*) | HOLD · Procurement |
| R-TOL-02 | Price variance within tolerance | ≤ 2% and ≤ $50 | APPROVE w/ note |
| R-LIN-01 | Invoice line not on the PO and not freight / discount / bundled (uncontracted item) | any | HOLD · Procurement — **never covered by tolerance** |
| R-BUN-01 | **Bundled billing:** unmatched invoice lines sum to the unbilled PO lines within price tolerance (3-way: those lines must be fully received) | price tolerance | note (header-level match) |
| R-FRT-01 | **Freight / shipping** line not on the PO | ≤ **$100** freight cap → note; above → HOLD · Procurement | note / HOLD |
| R-GRN-01 | Billed qty > received qty | 0 units | HOLD · Receiving |
| R-GRN-02 | 3-way PO with **no goods receipt recorded yet** | — | HOLD · Receiving ("Has this delivery arrived?") |
| R-PO-03 | **Cumulative billed would exceed PO** | > PO total + *PO-overrun tolerance* (default **0%**, a separate knob) | HOLD · Procurement |

Two tolerances, deliberately separate: **price tolerance** absorbs small unit-price drift on
contracted lines; **PO-overrun tolerance** governs spending beyond the PO budget. Loosening one
never loosens the other, and uncontracted lines are never tolerated.
| R-DUP-01 | Probable duplicate | score ≥ 0.85 | REJECT (link to original) |
| R-DUP-02 | Possible duplicate | 0.6–0.85 | HOLD · AP |
| R-APR-01 | Amount above approval threshold | > $25,000 | ROUTE FOR APPROVAL |
| R-SPL-01 | Just under threshold + same vendor recent sub-threshold invoices | 90–100%, ≥2 in 30 days | flag (stretch) |

---

## 6. Scenarios

The brief asks for 2–4 edge cases. **Headline set = EC-1..EC-4.** EC-5 is a robustness preset
in the demo launcher so the self-checking extraction is visibly exercised. The video shows the
happy path + 2–3 edge cases; the live interview can run all.

### Happy path — Clean digital invoice
Acme Office Supplies, explicit PO, 3 lines, separate sales tax, matches PO and GRN within
tolerance → **APPROVE**, touchless. Ledger updated.

### EC-1 · Split billing that overruns the PO — *"the process remembers"*
PO-2041: managed support, **384 hours @ $125.00/hr = $48,000.00**. Invoice #1 (128 h, $16,000)
and #2 (128 h, $16,000) already approved. Invoice #3 bills **140 h @ $125.00 = $17,500.00** — the
contracted line at the contracted rate, so price checks pass. But cumulative billed = 396 h /
$49,500 > 384 h / $48,000.
→ **HOLD · Procurement**: *"This invoice would bring total billing on PO-2041 to $49,500.00 —
12 hours / $1,500.00 (3.1%) over the PO. Approve a PO amendment, or ask the vendor to re-bill
within the remaining 128 hours?"*
**Note:** changing the *price* tolerance does not affect this (separate PO-overrun knob, default 0%).

### EC-2 · Scanned invoice with no PO number — *"infers, but never invents"*
Skewed, noisy scan (no text layer) from a known vendor, no PO ref. AI reads it from the image;
deterministic scoring finds PO-2077 (3/3 lines match) → proceeds with "PO inferred — 0.93" →
**APPROVE** (with note). *Stretch variant:* two equally plausible POs → **HOLD**: *"Is this for
PO-2077 or PO-2081?"*

### EC-3 · Disguised duplicate vs. legitimate repeat — *"no false alarms"*
- 3a: `INV-10422` resent as `INV10422-R`, new date, same amount/lines → **REJECT** (score 0.94), linked to original
- 3b: Same vendor, same $2,400, new invoice no., **next month's** service period → **APPROVE**

### EC-4 · Bank details changed — *"stops a $3B-a-year fraud pattern"*
Long-standing vendor, perfect PO match — but remittance bank account ≠ vendor master, and the
email came from a look-alike domain (`globex-billing.co` vs `globex.com`).
→ **HOLD · Treasury + PAYMENT BLOCK**: *"Bank details don't match our records. Verify by calling
the contact already on file — not the number on this invoice — before paying."*

### EC-5 (robustness preset) · Broken arithmetic / missing total — *"knows when it can't trust itself"*
An invoice whose line items don't sum to the printed subtotal and with no clearly printed total
(or a smudged total on a scan). Validate fails → targeted re-extract → still inconsistent →
**HOLD · AP**: *"Line items sum to $7,340 but the invoice states $7,430. Confirm the correct
amount with the vendor?"* Drafted vendor email included.

### PV (demo preset) · Supplier price increase — *the Policy-flip invoice*
Contracted line: 40 × toner cartridge @ $25.00 on PO-2052. Invoice bills **$26.05** (+4.2%, +$42.00
total) after a supplier price increase. At price tolerance 2% → **HOLD · Procurement** (R-TOL-01).
Change price tolerance to 5% in the AOP → re-run → **APPROVE** (R-TOL-02, within 5% and under $50),
banner: *"Decision changed: HOLD → APPROVE — unit-price variance 4.2% now within 5% tolerance."*
A legitimate use of tolerance: price drift on a contracted line, small absolute amount.

### Robustness fixtures (in the eval suite, not the launcher)
Each proves a rule on a realistic document: statement → REJECT · credit note → HOLD · bill-to
another company → HOLD · unknown vendor → HOLD · **bundled** website project (3 PO lines, 1
invoice line) → APPROVE w/ R-BUN-01 · **tax-inclusive** office-supplies invoice → APPROVE ·
**freight** line $45 → APPROVE w/ R-FRT-01 · **no receipt yet** → HOLD R-GRN-02 · **closed PO** →
HOLD R-PO-04 · **blocked vendor** → HOLD R-VEN-04 · **INR GST invoice** from an unknown vendor →
HOLD R-CUR-01 + R-VEN-01 · **missing invoice number and date** → HOLD R-EXT-01 · **the Zamp
Candidate Guide PDF itself** → REJECT R-DOC-02 (rehearsed live curveball: "upload anything").

### Deferred (stretch)
EC-2 tie variant · invoice-splitting under the approval limit (R-SPL-01) · date anomalies
(billed before PO issued, future-dated, stale) · several invoices in one PDF.

---

## 6b. Brief coverage matrix (shown in-app on the Assumptions tab)

| PS-1 brief says | Handled by | Proved by fixture |
|---|---|---|
| Invoices arrive by email, as PDFs | Intake (AP Inbox) | every inbox scenario |
| Some are clean machine-readable PDFs | Inspect → `digital`, quote verification | Happy |
| Some are scanned images | Inspect → `scanned`; Gemini reads the image | EC-2 |
| Line items itemised **or bundled** | Line matching + R-BUN-01 | Happy · bundled |
| Tax **embedded or separated** | Validate tax basis + R-TAX-01 | tax-inclusive · Happy |
| PO references explicit **or implied** | PO lookup + R-PO-02 | Happy · EC-2 |
| No invoice number, no date, no clear total | R-EXT-01 · R-EXT-02 | missing-fields · EC-5 |
| Approved vendors | R-VEN-01 · R-VEN-04 | unknown · blocked |
| PO amounts | R-PO-03 · R-TOL-01 | EC-1 · PV |
| Tolerance thresholds | R-TOL-01/02 + editable AOP | PV (2% → 5%) |
| Duplicate detection rules | R-DOC-01 · R-DUP-01/02 + recurring guard | EC-3a · EC-3b |
| Vendor splits one PO into multiple invoices | Cumulative PO ledger · R-PO-03 | EC-1 |
| Amounts close but not exact | R-TOL-02 | PV at 5% · tax-inclusive |
| Make a decision and explain it | Rules engine + templates | all |
| Everything in between visible | SSE timeline, evidence per field | all |

---

## 7. Approaches considered

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Custom web app** (Next.js + Postgres + LLM API, SSE pipeline) | Full control of graded UI; rules in code; one URL | Most to build | **Chosen** |
| B. n8n + Lovable/Retool | Visual workflow; fast wiring | Two glued systems; awkward live streaming; rules in node spaghetti; common | Rejected |
| C. Python + Streamlit | Fastest; great PDF tooling | Clunky streaming & dashboard; looks prototype-y | Fallback only |

---

## 8. Tech stack ($0 total)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript everywhere, on Node.js** (app, pipeline, scripts) | One language to build and explain |
| App | **Next.js (App Router)**; pipeline routes pinned to the Node.js runtime (`runtime = "nodejs"`) | UI + API in one codebase, one live URL; Node needed for PDF libs |
| UI | Tailwind + shadcn/ui (restyled flat: hairlines, no card shadows), Geist + Geist Mono, Lucide icons (functional only), Framer Motion | Shipped-product look, animated activity log; no chart library |
| Live run | Server-Sent Events | Simple one-way stage streaming |
| DB | **Neon Postgres (free)** + Drizzle ORM | All data, incl. PDFs as `bytea` (small files; no separate blob service) |
| AI | **Google Gemini API, free tier** via `@google/genai` | Native PDF input incl. scans; JSON-schema structured output; fast. Candidates (verified stable IDs, 2026-11-16): `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`. **Excluded:** `gemini-2.5-flash` (deprecated; silently re-routes to Flash-Lite on 2026-12-01), `gemini-3-flash-preview` (preview, can be pulled), `gemini-2.5-flash-lite` (existing users only). Chain set via env `GEMINI_MODELS`; order decided by the Day-2 bake-off |
| PDF text | `unpdf` (pdf.js) | Text-layer detection; quote verification |
| PDF viewer | `react-pdf` (canvas only, no text-layer matching) | Invoice beside the run. **Field evidence:** primary = click a field → jump to its page + verified-quote badge (works for digital and scanned). **Enhancement:** CSS overlay boxes from Gemini `box_2d` (0–1000, `[ymin,xmin,ymax,xmax]`, + page index) — enabled only if the Day-2 test shows boxes land on the right text for ≥ 90% of fields; each box also sanity-checked (in bounds, non-degenerate) or hidden |
| Hosting | **Vercel Hobby (free)** — 300s function limit; runs take seconds | One link to submit |
| Test data | TS script (dev-only): HTML invoice templates → Playwright → PDF (digital); Playwright screenshot → `sharp` (rotate/noise/blur) → `pdf-lib` (scanned, no text layer) | Same language; varied realistic layouts |

### AI call budget & resilience
- **1 AI call per invoice** (2 only when arithmetic fails). Explanations/emails are templated; PO inference is deterministic scoring.
- **Cache by file hash** → rehearsed/eval runs replay instantly at zero quota.
- **Provider interface** `extract(pdf) → ExtractedInvoice` — Gemini today, swappable in one file.
- **Key pool** `GEMINI_API_KEYS` (comma-separated): on a quota/429 response, move to the next key; on transient errors, retry with backoff. *(Owner's decision; keys are the owner's own accounts.)*
- **Model fallback:** Flash → Flash-Lite on persistent failure.
- **Last resort:** replay from cache, labeled "replayed" in the UI.
- Every retry/fallback shows in the live timeline as a `retrying…` event — never a frozen screen.

### Assumptions to record in-app
Free-tier Gemini inputs may be used by Google to improve products → only synthetic invoices
used; in production: paid tier with no-training terms. All vendors/POs/invoices synthetic. USD,
US-style sales tax. ERP simulated.

---

## 9. Data model (simulated procurement system)

- `vendors` — legal name, aliases, tax ID, status, **bank account (masked)**, email domain, contact on file, terms
- `purchase_orders` — PO no., vendor, lines (desc, qty, unit price), tax basis, total, status, **billed to date**
- `goods_receipts` — GRN no., PO no., lines received, date
- `inbox_messages` — simulated emails (from, subject, body, attachment → invoice)
- `invoices` — extracted data + PDF + hash + status
- `extraction_cache` — file hash → extraction JSON, model, timestamp
- `runs` — outcome, rules triggered, duration, model used, cache hit
- `run_events` — stage-by-stage stream (powers live view + replay)
- `audit_log` — decisions, overrides, policy changes (who/what/when/before/after)
- `policies` — versioned tolerance/threshold config

Seed: ~8 vendors, ~12 POs, ~10 GRNs, ~18 test documents (happy + EC-1..5 + PV + bonus + a
statement + a credit note + "prior" invoices that set up EC-1 and EC-3). Our company:
"Northwind Labs, Inc." (+ alias list) for the bill-to check.

---

## 10. Screens (3)

### App shell
Slim left navigation rail (white, hairline `border-r`): **Bills** (dashboard) · **Needs attention**
(same view, filter preset, with count badge) · **POs & vendors** (master data) · **AOP & controls**
(settings). Product name top-left, Reset demo data at the bottom of the rail. The run workspace
is `h-screen overflow-hidden`.

### Screen 1 — Bills (dashboard)
**KPI ledger strip** (Processed · Straight-through rate · Needs attention $ held · Fraud &
duplicates blocked $ · Eval suite 21/21 → click for results) · **AP Inbox** pane (simulated emails
with scenario tags → "Process"; doubles as the demo launcher) + drag-and-drop upload · bills table
(dense, status pills, primary reason, amount right-aligned) with **All / Needs attention** tabs ·
"Exceptions by type" as a hairline list with thin monochrome inline bars (no chart library).

### Screen 2 — Run workspace (live and replay) — Ramp-style split view
- **Left pane, 45%, full height — Document canvas:** compact toolbar (`Email envelope ▾`,
  `Source: scanned PDF`, `Page 1/1`, zoom), PDF on stone `#F4F4F2` backdrop, evidence highlights.
- **Right pane, 55%, full height, scrolls — Inspector:**
  - *Sticky header:* vendor, invoice # (mono), total in large tabular numerals, status pill.
  - *Body:* **Agent activity log** streams while running; on completion it collapses to a
    one-line summary (`10 steps · 2.4 s · Gemini 3.6 Flash · cached`, expandable), revealing the
    **decision banner** (outcome, reasons, rule chips, the one question), the **3-way match grid**
    (`Item | Ordered | Received | Billed | Unit price | Variance`, tint only on breaking cells), the
    **drafted email / action** preview, and the audit trail.
  - *Sticky footer action bar — contextual to the outcome:*
    - Needs attention → `Approve & post` (reason required) · `Send vendor query` (opens draft:
      copy / mark as sent — no real email) · `Reject` · `Re-run against AOP`
    - Pending sign-off → `Sign off & post` · `Reject`
    - Rejected → `Override…` (reason required) · `Re-run against AOP`
    - Approved & posted → `View ledger entry` · `Re-run against AOP`

*Wireframe (completed state):*
```
┌────┬──────────────────────────────┬────────────────────────────────────────────────┐
│ ▤  │ Email ▾  Scanned PDF  1/1  ⊕ │ Globex Corporation   INV-10601     $9,870.00   │
│Bills│─────────────────────────────│ ● Needs attention                    ─ sticky ─│
│ ⚑ 3│                              │────────────────────────────────────────────────│
│POs │   ┌──────────────────────┐   │ ✓ Agent activity log · 10 steps · 2.4 s     ▸ │
│AOP │   │                      │   │────────────────────────────────────────────────│
│    │   │      invoice page    │   │ Needs attention — 2 fraud signals · high risk  │
│    │   │   ▒▒ evidence ▒▒     │   │ Bank details don't match our records (••7731)  │
│    │   │                      │   │ Sent from globex-billing.co, not globex.com    │
│    │   └──────────────────────┘   │ R-VEN-02  R-VEN-03          Owner: Treasury    │
│    │        stone #F4F4F2         │ ? Verify via the contact on file before paying │
│    │                              │────────────────────────────────────────────────│
│    │                              │ ITEM        ORDERED RECEIVED BILLED  VARIANCE  │
│    │                              │ Rack kit          2        —      2     $0.00  │
│    │                              │────────────────────────────────────────────────│
│    │                              │ [Approve & post] [Send vendor query] [Reject]  │
│    │                              │                         [Re-run against AOP]   │
└────┴──────────────────────────────┴────────────────────────────────────────────────┘
```
While running, the activity log fills the inspector body (paced reveal); on completion it
collapses to the one-line summary and the decision banner + match grid take its place.

### Screen 3 — AOP & controls / POs & vendors (tabs; each nav item opens its tab)
**AOP & controls** — subtitle *"the tolerances, approval matrix and escalation rules
the agent runs against every invoice"*: price tolerance (% and $), PO-overrun tolerance, freight cap ($100), approval
threshold, duplicate thresholds, owner per exception type → *Save & re-run last invoice*;
versioned, every change in the audit log · **Master data** (vendors incl. bank + email domain,
POs + billed-to-date, GRNs; read-only) · **Assumptions** (incl. the §6b brief coverage matrix).

### UI quality bar (the UI is graded)

The guide: *"The UI is part of the grade — we expect an intuitive, well-designed interface with
a live run view… and a dashboard."*

**Visual language — "a shipped fintech workbench" (Ramp Bill Pay / Linear / Stripe patterns)**
- **Flush split panes, not floating cards.** Full-viewport app; regions separated by 1px hairlines (`border-r`, `border-b`, `divide-y`), no `rounded-xl shadow-md` card grids, no big gaps on a grey page. Rounded corners only on pills, buttons, inputs.
- **Monochrome + semantic signal palette.** Ink `#0A0A0A` (headings, amounts), `#52525B` secondary, `#71717A` muted. Surfaces `#FFFFFF` (tables, inspector) and warm stone `#F7F7F5` (secondary headers, PDF backdrop `#F4F4F2`); borders `#E4E4E7`. Primary button obsidian `#111827` with subtle hover. **No** purple/indigo gradients, glows, sparkle/robot icons, decorative icon circles, or multi-colour charts. No borrowed brand colours.
- **Status pills, used identically everywhere:** 1px-bordered pill with a 6px dot — `● Approved & posted` (emerald), `● Pending sign-off` (blue), `● Needs attention` (amber), `● Rejected` (crimson). Coloured text uses AA-contrast shades (e.g. amber `#B45309`).
- **Accounting typography:** Geist (UI) with `tabular-nums` on every amount, right-aligned money columns, always `$` + 2 decimals, signed variances (`+$1,500.00 · +3.1%`). **Geist Mono** for identifiers: rule IDs (`R-VEN-02`), invoice/PO/GRN numbers, confidence scores, ms timings. Amounts stay in tabular sans (mono amounts read as "developer tool").
- **Dense tables:** 36–40px rows, 11px uppercase tracked column headers (`tracking-wider`, `#71717A`), cell-level amber/red tint **only** on the exact cell that broke a rule.
- **Plain words first, codes second:** "Needs attention — bank details changed" with `R-VEN-02` as a small mono chip; tooltips for jargon ("GRN — what the warehouse actually received").
- **Legibility for recording:** body 14px, table cells 13px, column headers 11px uppercase (the only sub-13px text). Record the video at 1440×900 with browser zoom 110%.
- Below 1024px wide, split panes stack vertically (not a demo target, but nothing breaks).

**Vocabulary:** `Needs attention` (escalated-to-human queue and status), `Agent activity log` (the live step trace), `AOP & controls` (the Agent Operating Procedure — a term Zamp uses in its AP guide), `Straight-through rate` (standard AP term for touchless). *Note: "Needs attention" and "Agent activity log" are common industry conventions, not verified Zamp labels — don't claim otherwise in the interview.*

**Signature moments**
1. **Live timeline:** stages revealed one by one (paced playback, true ms badges); findings appear as they land; active stage pulses; extracted fields link to their evidence on the PDF (overlay boxes if the Day-2 test passes)
2. **Decision card:** big outcome, one-sentence reason, the one question, action buttons — readable in a small video frame
3. **3-way match table:** violating cells highlighted; hover shows the rule
4. **Policy flip (PV preset):** change *price* tolerance 2% → 5% in the AOP → re-run → banner *"Decision changed: HOLD → APPROVE — unit-price variance 4.2% now within 5% tolerance"*
5. **KPI ledger strip:** one hairline-divided row (`grid-cols-5 divide-x border-b`), not five cards — Processed · Straight-through rate · Needs attention ($ held) · Fraud & duplicates blocked ($) · Eval suite (21/21)

**Every state designed:** empty, loading, retrying (calm, not broken), error, cached-replay label.

**Process**
- Day 2: clickable mock of all 3 screens on fake data (no backend) — react to the look early
- UI developed against recorded `run_events` fixtures, so it's never blocked on the pipeline
- Day 6: polish pass against this checklist (consistency, alignment, states, recording legibility)

---

## 11. Demo resilience

- One-click launcher per scenario, in rehearsed order
- **Reset demo data** restores ledger state so EC-1 / EC-3 behave identically every time
- Cache by file hash (visible toggle "use cached extraction"); fresh runs available on demand
- Retries, key pool, model fallback, cache replay (§8) — all visible in the timeline
- Every stage has a rendered error state; no blank screens
- Unknown/garbage uploads (interviewer's own PDF, non-invoice) → graceful HOLD with reason
- Eval suite run before every demo

---

## 12. Decisions (resolved)

| # | Decision | Resolution |
|---|---|---|
| 1 | Stack | TypeScript on Node.js throughout — Next.js app, Node-runtime pipeline, TS data scripts |
| 2 | Locale | US / USD / sales tax |
| 3 | Edge cases | EC-1..EC-4 headline + EC-5 robustness preset |
| 4 | Email intake | Simulated AP Inbox in-app; no real inbound email |
| 5 | Spend | $0: Gemini free tier, Vercel Hobby, Neon free |
| 6 | Screens | 3 (Dashboard · Run workspace · Settings) |

---

## 13. Week schedule

| Day | Focus | Done when |
|---|---|---|
| **1** | Email coordinator "ASA Case Study — [Name] — PS-1". Create Gemini keys, check limits in AI Studio. **Model smoke test** (`scripts/check-models.ts`): `models.list` + one tiny PDF→JSON call per candidate ID per key — confirms ID, PDF input and JSON schema all work. Generate seed data + ~17 test PDFs (incl. scans, a statement, a credit note) | Smoke test green; PDFs + seeded DB exist |
| **2** | Stages 1–4 + extraction schema + cache + key pool. **Model bake-off:** candidates on all test PDFs → pick by field accuracy, then latency; same run measures `box_2d` hit-rate (and whether asking for boxes hurts field accuracy) → overlay on/off. **Clickable UI mock** of the 3 screens on fake data | Happy path extracts correctly; model chain + overlay decision recorded; you've reacted to the mock |
| **3** | Stages 5–10: vendor, PO scoring, 3-way match, duplicates, rules engine, templates. Eval harness. Record `run_events` fixtures | Happy + EC-1..5 correct in eval |
| **4** | Run workspace (animated SSE timeline, PDF with field highlights, decision card, comparison) + deploy to Vercel | A run streams live on the public URL |
| **5** | Dashboard (KPIs, table, inbox, launcher, reset), Settings (policy + re-run banner, data, assumptions), override actions + audit | Full UI clickable end-to-end |
| **6** | Resilience (§11), **UI polish pass against the quality bar**, stretch if ahead. Rehearse demo 3× | Clean demo 3 times in a row |
| **7** | Record 5-min video, submit link + video | Submitted |

**Cut line if behind:** EC-2 tie variant → dark mode → box overlays (page-jump + quote stays) →
override actions → policy re-run banner.
Never cut: run workspace, dashboard, EC-1..4, reset/demo launcher, cache, designed states.

---

## 14. 5-minute video script (draft)

1. **0:00–0:30** — Problem in buyer terms (tired person on a Friday, ~$9.40/invoice, fraud). Pitch line.
2. **0:30–1:30** — Happy path from the AP Inbox: stages stream, decision card, "touchless".
3. **1:30–3:30** — EC-3 pair back-to-back, then EC-4. Point at EC-1 / EC-5 results on dashboard.
4. **3:30–4:15** — Design judgment: AI extracts, rules decide; evidence per field; self-checking math; change tolerance → re-run.
5. **4:15–5:00** — Dashboard metrics, tests 15/15, next steps (ERP connector, learning from overrides, vendor portal).

---

## 15. Interview prep

- *Why not let the AI decide?* → Auditability, determinism, cost of error; explanations are templated from rules so they can't contradict the decision.
- *How do you know extraction is right?* → Quote verification, arithmetic reconciliation, confidence, eval set.
- *Why Gemini?* → Free tier for the build; native PDF + JSON schema; model-agnostic interface — production model chosen by running the same eval.
- *10,000 invoices/month?* → Paid tier, batch API, queue workers, cheaper model for clean digital PDFs, cache vendor/PO context.
- *AI wrong on a scan?* → Low confidence or arithmetic failure → human; never auto-approve.
- *How would it learn?* → Reviewer overrides → suggested per-vendor/category tolerances.

---

## 16. Left to the builder

Exact schema field names; prompt wording; styling; seed specifics within the scenarios above;
fuzzy-match and PO-scoring weights (tune against eval).

---

## Research sources
- Zamp — AI agents for AP: https://zamp-website.vercel.app/blogs/ai-agents-for-accounts-payable
- Ramp — Best practices for AP agents: https://ramp.com/blog/agentic-ai/best-practices-for-ap-agents
- Microsoft — AP invoice matching tolerances: https://learn.microsoft.com/en-us/previous-versions/dynamicsax-2012/appuser-itpro/about-accounts-payable-invoice-matching
- Peakflo — 3-way matching: https://peakflo.co/blog/three-way-matching-accounts-payable
- Spendesk — Duplicate invoices: https://www.spendesk.com/blog/duplicate-invoices/
- Infrrd — Detecting duplicates: https://www.infrrd.ai/blog/how-to-detect-duplicate-invoices
- Corpay — BEC & AP: https://www.corpay.com/resources/blog/business-email-compromise-ap
- Kognitos — Bank-detail change fraud: https://www.kognitos.com/blog/vendor-payment-fraud-bank-detail-change-bec-ap-controls-2026/
- ApprovalMax — AP fraud red flags: https://blog.approvalmax.com/accounts-payable-fraud-types-red-flags-and-how-to-prevent-it
- Gemini pricing / free tier: https://aistudio.google.com/docs/pricing
- Gemini rate limits: https://aistudio.google.com/docs/rate-limits
- Vercel function limits: https://vercel.com/docs/functions/limitations
