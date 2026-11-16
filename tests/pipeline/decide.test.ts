import { describe, expect, it } from "vitest";
import { decide } from "@/pipeline/stages/decide";
import { explain } from "@/templates/explain";
import { DEFAULT_POLICY } from "@/domain/policy";
import { RULE_IDS, type RuleHit } from "@/domain/types";
import { VENDORS } from "../../fixtures/seed-data";

const vendor = (id: string) => VENDORS.find((v) => v.id === id)!;
const ctx = (vendorId: string | null = "V-ACME") =>
  ({ policy: DEFAULT_POLICY, vendor: vendorId ? vendor(vendorId) : null, invoiceNumber: "INV-1", totalCents: 100_000 });
const h = (rule: RuleHit["rule"], outcome: RuleHit["outcome"], facts: RuleHit["facts"] = {}): RuleHit => ({ rule, outcome, facts });

const EC1 = h("R-PO-03", "HOLD", { poNumber: "PO-2041", poTotal: 4_800_000, cumulativeAfter: 4_950_000, overrunCents: 150_000, overrunPct: 0.03125, overUnits: 12, remainingUnits: 128 });
const BANK = h("R-VEN-02", "HOLD", { invoiceLast4: "7731", masterLast4: "0492" });
const SENDER = h("R-VEN-03", "HOLD", { senderDomain: "globex-billing.co", expectedDomain: "globex.com" });

describe("decide", () => {
  it("approves touchless when nothing fired", () => {
    const d = decide([], ctx());
    expect(d.outcome).toBe("APPROVE");
    expect(d.summary).toBe("Approved — touchless");
    expect(d.primary).toBeNull();
  });

  it("keeps notes as reasons without changing the outcome", () => {
    const d = decide([h("R-TOL-02", "NOTE", { line: "Toner", pct: 0.01, cents: 100 })], ctx());
    expect(d.outcome).toBe("APPROVE");
    expect(d.reasons).toHaveLength(1);
  });

  it("routes for sign-off above the approval threshold", () => {
    const d = decide([h("R-APR-01", "ROUTE_FOR_APPROVAL", { total: 2_600_000, threshold: 2_500_000 }), h("R-TOL-02", "NOTE", { line: "x", pct: 0.01, cents: 1 })], ctx());
    expect(d.outcome).toBe("ROUTE_FOR_APPROVAL");
    expect(d.owner).toBe("Approver");
  });

  it("asks the exact EC-1 question", () => {
    const d = decide([EC1], ctx("V-INITECH"));
    expect(d.outcome).toBe("HOLD");
    expect(d.owner).toBe("Procurement");
    expect(d.question).toBe(
      "This invoice would bring total billing on PO-2041 to $49,500.00 — 12 hours / $1,500.00 (3.1%) over the PO. Approve a PO amendment, or ask the vendor to re-bill within the remaining 128 hours?",
    );
  });

  it("flags two fraud signals, blocks payment and routes to Treasury (EC-4)", () => {
    const d = decide([BANK, SENDER], ctx("V-GLOBEX"));
    expect(d).toMatchObject({ outcome: "HOLD", owner: "Treasury", paymentBlocked: true, fraudSignals: 2 });
    expect(d.summary).toContain("2 fraud signals · high risk");
    expect(d.question).toBe("Verify by calling the contact already on file — not the number on this invoice — before paying.");
    expect(d.email).toBeNull(); // never reply into a possibly compromised thread
  });

  it("lets REJECT win over HOLD", () => {
    expect(decide([BANK, h("R-DUP-01", "REJECT", { original: "INV-10422", score: 0.91 })], ctx()).outcome).toBe("REJECT");
  });

  it("drafts a vendor email when the vendor must fix something", () => {
    const d = decide([h("R-EXT-02", "HOLD", { reason: "Line items sum to $7,340.00 but the invoice states $7,430.00" })], ctx("V-SOYLENT"));
    expect(d.email?.to).toBe("billing@soylentcatering.com");
    expect(d.email?.body).toContain("$7,340.00");
    expect(d.question).toBe("Line items sum to $7,340.00 but the invoice states $7,430.00. Confirm the correct amount with the vendor?");
  });

  it("blocks payment for a blocked vendor without counting it as fraud", () => {
    expect(decide([h("R-VEN-04", "HOLD", { status: "blocked" })], ctx("V-VANDELAY"))).toMatchObject({ paymentBlocked: true, fraudSignals: 0 });
  });

  it("approves with two notes for bundled billing plus freight", () => {
    const d = decide([h("R-BUN-01", "NOTE", { invoiceLines: 1, poLines: "a, b" }), h("R-FRT-01", "NOTE", { amount: 4500, cap: 10000 })], ctx());
    expect(d.outcome).toBe("APPROVE");
    expect(d.reasons).toHaveLength(2);
  });

  it("holds freight above the allowance for Procurement", () => {
    expect(decide([h("R-FRT-01", "HOLD", { amount: 12000, cap: 10000 })], ctx())).toMatchObject({ outcome: "HOLD", owner: "Procurement" });
  });

  it("makes the unknown vendor the primary reason but keeps the currency reason", () => {
    const d = decide([h("R-CUR-01", "HOLD", { currency: "INR" }), h("R-VEN-01", "HOLD", { vendorName: "Bharat Office Solutions Pvt Ltd" })], ctx(null));
    expect(d.primary?.rule).toBe("R-VEN-01");
    expect(d.reasons).toHaveLength(2);
  });

  it("has a non-empty explanation for every rule", () => {
    for (const r of RULE_IDS) expect(explain(r, {}).reason.length, r).toBeGreaterThan(0);
  });
});

describe("RULE_TITLES", () => {
  it("has a title for every rule", async () => {
    const { RULE_TITLES } = await import("@/templates/explain");
    for (const r of RULE_IDS) expect(RULE_TITLES[r]?.length, r).toBeGreaterThan(3);
  });
});
