export function extractionPrompt(withBoxes: boolean): string {
  return `You are an accounts-payable document reader. Read the attached document and return JSON matching the schema.

Rules:
- Extract only what is printed. If a field is absent, return value null with low confidence. Never infer, compute or guess totals, dates or numbers.
- "quote" is the exact text as printed for that value (verbatim, including currency symbols). "page" is 1-based.
- Amounts are decimal numbers in the document's currency. Credits, returns and discounts are negative.
- A lump-sum line with no quantity or unit price has quantity null and unitPrice null.
- lineType per line: goods, service, freight (shipping / delivery / handling / postage), tax (a tax shown as a line), discount, or other.
- taxInclusive is true only if the document states that prices include tax; false if tax is added separately; null if unclear.
- taxTotal is the total tax amount printed (sum of all tax rows, or the stated included tax).
- vendorName and billTo are the legal entity names only (e.g. "Acme Office Supplies, LLC") — never the street address; quote just the name line.
- currency is an ISO code (USD, INR, EUR, GBP…) from symbols or text; null if not determinable.
- servicePeriod is YYYY-MM only if a billing/service period is printed; otherwise null.
- bankAccount is the remittance bank account as printed (routing-account for US banks, e.g. "021000021-4417730001").
- documentType: "invoice" for a bill requesting payment; "credit_note" for a credit/credit memo; "statement" for a statement of account; "purchase_order" for a PO; "quote" for a quotation/estimate; "receipt" for a paid receipt; "other" for anything else (letters, guides, contracts, forms).
- documentTypeReason: at most 12 words explaining the classification.
- If the document is not an invoice, still return every key with null values where nothing applies, and an empty lines array.${
    withBoxes ? "\n- box is [ymin, xmin, ymax, xmax] of the printed value on its page, normalised to 0-1000; null if not printed." : ""
  }`;
}

export function reextractPrompt(withBoxes: boolean, reason: string): string {
  return `${extractionPrompt(withBoxes)}

A previous read did not reconcile: ${reason}. Re-read every line amount, the subtotal, tax and total digit by digit. Report exactly what is printed, even if the printed numbers do not add up.`;
}
