# Demo runbook — PS-1 Invoice Agent

## Before the demo (5 minutes)

1. Open the app and click **Reset demo data** (left rail, bottom). The bills table is now empty.
2. Check the ledger strip: **Eval suite 21/21** in green. If not, stop and run `npx tsx scripts/eval.ts`.
3. Warm the app: open one stored run and the AOP page once (first loads are slower).
4. Browser at 1440×900 (or 1280×720) and **zoom 110%** for recording. Close other tabs; turn off notifications.
5. Have these files on the desktop for "upload anything": `fixtures/pdfs/zamp-candidate-guide.pdf` (kept out of the seeded inbox, so it is never public on the deployed site), `fixtures/pdfs/acme-AC-5531-photo.jpg`.

## Run order (5-minute video)

| # | Do | Say (one line) |
|---|---|---|
| 1 | Bills screen, point at the ledger strip | "An AP agent: AI reads the invoice, rules make the decision, a person answers one question when it matters." |
| 2 | Inbox → **Happy** → Process | "Every step streams live with its real timing. Every field carries a quote verified on the page." |
| 3 | Decision: Approved & posted | "Touchless: matched PO, receipt and price, then posted and read the ledger back to confirm the write." |
| 4 | **EC-3a** then **EC-3b** | "A resend with a tweaked number is rejected as a duplicate — but next month's identical subscription is approved. The service-period guard prevents the false alarm." |
| 5 | **EC-4** | "Amounts are perfect, but the bank account changed and the email came from a look-alike domain. Payment blocked; the one question tells Treasury to call the contact on file." |
| 6 | **PV** → held at 2% | "A 4.2% supplier price increase on a contracted line." |
| 7 | AOP & controls → price tolerance 5% → **Save & re-run last invoice** | "Policy is configuration, not code. The decision flips — and the banner says exactly why." |
| 8 | Bills → point at **EC-1**, **EC-5** in the table | "Split billing that overruns the PO at contracted prices; and an invoice whose lines don't add up — re-read once, then held, never guessed." |
| 9 | AOP → Assumptions & brief coverage | "Every sentence of the brief maps to a rule and a fixture that proves it — 21 of 21." |

## Live-interview extras
- Upload the **Zamp candidate guide** → "Rejected — not an invoice".
- Upload the **phone photo** → read as a scan.
- Click **Replay** on any stored run to show the paced log again.

## Recovery moves
- **Gemini slow or rate-limited:** recorded extractions replay instantly (the log says `cached`); the key pool rotates keys and falls back 3.1 Flash-Lite → 3.5 Flash-Lite → 3.6 Flash, shown as "Retrying…" in the log.
- **A run failed:** the workspace shows "The run couldn't finish — nothing was posted"; click **Re-run against AOP**.
- **State got messy:** Reset demo data.
- **No network at all:** `npm run dev:offline` runs the full app on recorded fixtures.

## Likely questions
- **Why not let the AI decide?** Auditability and determinism. AI only extracts; a rules engine decides; explanations are templated from the same rule facts, so they can't contradict the decision.
- **How do you know extraction is right?** Quotes verified against the PDF text layer, arithmetic reconciliation with one targeted re-read, field confidence, and a 21-scenario eval.
- **Why Gemini?** Free tier for the build; native PDF + JSON-schema output. The extractor is one interface — a production model is chosen by running the same eval.
- **Which model, and why?** A bake-off (`docs/bakeoff-report.md`): three models tie at 100% field accuracy, so the fastest (3.1 Flash-Lite, 4.2 s) leads and the others are fallbacks.
- **Are the highlights the model's guess?** No. Model boxes were right 78% of the time, so highlights are placed from the PDF text layer using the verified quote — 68/68 on digital PDFs. Scans get no highlight rather than a wrong one.
- **What did real extraction catch that fixtures didn't?** The model returned the bill-to with its address, which made the bill-to check hold clean invoices. Prompt and matcher both fixed; the bake-off now scores bill-to.
- **10,000 invoices a month?** Paid tier, batch API, queue workers, cheaper model for clean digital PDFs, cached vendor/PO context.
- **What if the AI misreads a scan?** Low confidence or failed arithmetic → a person; never auto-approved.
- **How would it learn?** Reviewer overrides become suggested per-vendor / per-category tolerances in the AOP.
- **What's not built?** Real ERP, payments, multi-PO invoices, partial deliveries across invoices, credit-note processing — listed on the Assumptions tab.
