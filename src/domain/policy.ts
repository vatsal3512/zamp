import type { Owner, Policy, RuleId } from "./types";

const owners: Record<RuleId, Owner> = {
  "R-DOC-01": "AP", "R-DOC-02": "AP", "R-DOC-03": "AP", "R-DOC-04": "AP",
  "R-EXT-01": "AP", "R-EXT-02": "AP", "R-TAX-01": "AP", "R-CUR-01": "AP",
  "R-DUP-01": "AP", "R-DUP-02": "AP",
  "R-VEN-01": "Procurement", "R-VEN-04": "Procurement",
  "R-PO-01": "Procurement", "R-PO-02": "Procurement", "R-PO-03": "Procurement", "R-PO-04": "Procurement",
  "R-TOL-01": "Procurement", "R-TOL-02": "Procurement", "R-LIN-01": "Procurement",
  "R-BUN-01": "Procurement", "R-FRT-01": "Procurement",
  "R-VEN-02": "Treasury", "R-VEN-03": "Treasury",
  "R-GRN-01": "Receiving", "R-GRN-02": "Receiving",
  "R-APR-01": "Approver",
};

export const DEFAULT_POLICY: Policy = {
  version: 1,
  priceTolPct: 0.02,
  priceTolAbsCents: 5000,
  poOverrunPct: 0,
  freightCapCents: 10000,
  approvalThresholdCents: 2_500_000,
  dupRejectScore: 0.85,
  dupHoldScore: 0.6,
  dupWindowDays: 90,
  quoteMinSimilarity: 0.9,
  maxTaxRate: 0.15,
  owners,
};
