import { describe, expect, it } from "vitest";
import { GOODS_RECEIPTS, PURCHASE_ORDERS, VENDORS, SEED } from "../../fixtures/seed-data";
import { SCENARIOS } from "../../fixtures/scenarios";
import { BRIEF_COVERAGE } from "../../fixtures/brief-coverage";
import { RULE_IDS } from "@/domain/types";
import { DEFAULT_POLICY } from "@/domain/policy";

const po = (n: string) => PURCHASE_ORDERS.find((p) => p.poNumber === n)!;

describe("seed data", () => {
  it("every PO total equals the sum of its lines", () => {
    for (const p of PURCHASE_ORDERS) {
      const sum = p.lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
      expect(p.totalCents, p.poNumber).toBe(sum);
    }
  });

  it("pins the PO totals the scenarios depend on", () => {
    expect(po("PO-2041").totalCents).toBe(4_800_000);
    expect(po("PO-2041").billedToDateCents).toBe(3_200_000);
    expect(po("PO-2090").totalCents).toBe(734_000);
    expect(po("PO-2095").totalCents).toBe(350_000);
    expect(po("PO-2019").status).toBe("closed");
  });

  it("has no goods receipt for PO-2058", () => {
    expect(GOODS_RECEIPTS.some((g) => g.poNumber === "PO-2058")).toBe(false);
  });

  it("every PO references an existing vendor", () => {
    const ids = new Set(VENDORS.map((v) => v.id));
    for (const p of PURCHASE_ORDERS) expect(ids.has(p.vendorId), p.poNumber).toBe(true);
  });

  it("bundles the default policy into SEED", () => {
    expect(SEED.policy).toEqual(DEFAULT_POLICY);
  });
});

describe("scenarios", () => {
  it("has 21 scenarios with unique files", () => {
    expect(SCENARIOS).toHaveLength(21);
    expect(new Set(SCENARIOS.map((s) => s.file)).size).toBe(21);
  });

  it("only expects valid rule IDs", () => {
    for (const s of SCENARIOS) for (const r of s.expected.rules) expect(RULE_IDS, s.id).toContain(r);
  });

  it("puts exactly 8 scenarios in the launcher", () => {
    expect(SCENARIOS.filter((s) => s.launcher).map((s) => s.id)).toEqual([
      "happy", "ec1", "ec2", "ec3a", "ec3b", "ec4", "ec5", "pv",
    ]);
  });
});

describe("brief coverage", () => {
  it("has the 15 rows of spec §6b, each pointing at real scenarios", () => {
    expect(BRIEF_COVERAGE).toHaveLength(15);
    const ids = new Set(SCENARIOS.map((s) => s.id));
    for (const row of BRIEF_COVERAGE) {
      expect(row.scenarioIds.length, row.brief).toBeGreaterThan(0);
      for (const id of row.scenarioIds) expect(ids.has(id), `${row.brief} → ${id}`).toBe(true);
    }
  });
});
