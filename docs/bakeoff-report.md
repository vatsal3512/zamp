# Model bake-off

Every scenario PDF (21) is extracted by each model through the same key pool, sequentially, and scored against
the scenario truth: document type, invoice number, total, PO number, vendor name and line count (116 field checks).
Re-run with `npx tsx scripts/bakeoff.ts [--models a,b] [--boxes]`; bill-to is scored from the next run on.

## Decision

| | |
|---|---|
| **Model order** | `gemini-3.1-flash-lite, gemini-3.5-flash-lite, gemini-3.6-flash, gemini-3.8-flash` |
| **Why** | Three models tie at 100% field accuracy; 3.1 Flash-Lite is fastest (4.2 s median vs 8.7 s and 25.8 s). The others stay as fallbacks for quota or outages. 3.8 Flash was capacity-limited (10/21 failed on 503s). |
| **Highlights** | Model bounding boxes landed on the right text 78% of the time (40/51). Instead, boxes are placed from the PDF text layer using the verified quote: 68/68 on digital PDFs. `EXTRACT_BOXES` stays off, so scans show no highlight rather than a wrong one. |
| **End-to-end** | With the chosen order, the eval passes 21/21 on fresh Gemini extractions, each scenario firing exactly its expected rules. |

**Found by running on real output:** the reader returned the whole bill-to block (name and address), so the bill-to
check (R-DOC-03) held 16 clean invoices. Fixed in both places: the prompt asks for the entity name only, and the check
matches the company name inside the bill-to's first line, while still catching "Northwind Logistics GmbH".

## Runs

### 2026-11-17 00:11 UTC (boxes off)

| model | boxes | field accuracy | median latency | box hits (digital) | failed |
|---|---|---|---|---|---|
| gemini-3.6-flash | off | 100.0% (116/116) | 25812 ms | — | 0 |
| gemini-3.8-flash | off | 100.0% (61/61) | 299578 ms | — | 10 |
| gemini-3.5-flash-lite | off | 100.0% (116/116) | 8704 ms | — | 0 |
| gemini-3.1-flash-lite | off | 100.0% (116/116) | 4157 ms | — | 0 |

### 2026-11-17 00:28 UTC (boxes on)

A first boxes-on run failed every document: the parser rejected `null` / empty boxes for absent fields. Boxes are now
optional decoration and a malformed one is dropped, never fatal.

| model | boxes | field accuracy | median latency | box hits (digital) | failed |
|---|---|---|---|---|---|
| gemini-3.1-flash-lite | on | 100.0% (116/116) | 4563 ms | 40/51 | 0 |
| gemini-3.5-flash-lite | on | 100.0% (116/116) | 6725 ms | 38/51 | 0 |
