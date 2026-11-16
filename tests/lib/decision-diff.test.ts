import { describe, expect, it } from "vitest";
import { decisionDiff } from "@/lib/decision-diff";
import { decide } from "@/pipeline/stages/decide";
import { DEFAULT_POLICY } from "@/domain/policy";
import type { RuleHit } from "@/domain/types";

const d = (hits: RuleHit[]) => decide(hits, { policy: DEFAULT_POLICY, vendor: null, invoiceNumber: "UP-4410", totalCents: 112_797 });

describe("decisionDiff", () => {
  const held = d([{ rule: "R-TOL-01", outcome: "HOLD", facts: { scope: "line", pct: 0.042, cents: 4200, tolPct: 0.02, tolAbs: 5000 } }]);
  const approved = d([{ rule: "R-TOL-02", outcome: "NOTE", facts: { pct: 0.042, cents: 4200, tolPct: 0.05 } }]);

  it("explains the PV policy flip", () => {
    expect(decisionDiff(held, approved, { ...DEFAULT_POLICY, priceTolPct: 0.05 }))
      .toBe("Decision changed: HOLD → APPROVE — unit-price variance 4.2% now within 5% tolerance");
  });

  it("returns null when the outcome did not change", () => {
    expect(decisionDiff(held, held, DEFAULT_POLICY)).toBeNull();
  });

  it("names a rule that newly applies when the outcome gets stricter", () => {
    expect(decisionDiff(approved, held, DEFAULT_POLICY)).toBe("Decision changed: APPROVE → HOLD — price over tolerance now applies");
  });
});
