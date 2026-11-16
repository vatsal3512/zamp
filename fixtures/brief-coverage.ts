/** Spec §6b — every sentence of the PS-1 brief mapped to the rule(s) that handle it and the fixture that proves it. */
export const BRIEF_COVERAGE: { brief: string; handledBy: string; scenarioIds: string[] }[] = [
  { brief: "Invoices arrive by email, as PDFs", handledBy: "Intake (AP Inbox)", scenarioIds: ["happy", "ec1", "ec2", "ec3a", "ec3b", "ec4", "ec5", "pv"] },
  { brief: "Some are clean machine-readable PDFs", handledBy: "Inspect → digital, quote verification", scenarioIds: ["happy"] },
  { brief: "Some are scanned images", handledBy: "Inspect → scanned; Gemini reads the image", scenarioIds: ["ec2"] },
  { brief: "Line items itemised or bundled", handledBy: "Line matching + R-BUN-01", scenarioIds: ["happy", "bundled"] },
  { brief: "Tax embedded or separated", handledBy: "Validate tax basis + R-TAX-01", scenarioIds: ["taxincl", "happy"] },
  { brief: "PO references explicit or implied", handledBy: "PO lookup + R-PO-02", scenarioIds: ["happy", "ec2"] },
  { brief: "No invoice number, no date, no clear total", handledBy: "R-EXT-01 · R-EXT-02", scenarioIds: ["missing", "ec5"] },
  { brief: "Approved vendors", handledBy: "R-VEN-01 · R-VEN-04", scenarioIds: ["unknown", "blocked"] },
  { brief: "PO amounts", handledBy: "R-PO-03 · R-TOL-01", scenarioIds: ["ec1", "pv"] },
  { brief: "Tolerance thresholds", handledBy: "R-TOL-01/02 + editable AOP", scenarioIds: ["pv"] },
  { brief: "Duplicate detection rules", handledBy: "R-DOC-01 · R-DUP-01/02 + recurring guard", scenarioIds: ["ec3a", "ec3b"] },
  { brief: "Vendor splits one PO into multiple invoices", handledBy: "Cumulative PO ledger · R-PO-03", scenarioIds: ["ec1"] },
  { brief: "Amounts close but not exact", handledBy: "R-TOL-02", scenarioIds: ["pv", "taxincl"] },
  { brief: "Make a decision and explain it", handledBy: "Rules engine + templates", scenarioIds: ["happy", "ec4"] },
  { brief: "Everything in between visible", handledBy: "Agent activity log, evidence per field", scenarioIds: ["happy", "ec2"] },
];
