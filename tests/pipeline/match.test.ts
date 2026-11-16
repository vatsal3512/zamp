import { describe, expect, it } from "vitest";
import { match } from "@/pipeline/stages/match";
import { DEFAULT_POLICY } from "@/domain/policy";
import { GOODS_RECEIPTS, PURCHASE_ORDERS } from "../../fixtures/seed-data";
import { makeNetLines } from "../helpers/make-invoice";
import type { NetLine, Policy, PurchaseOrder } from "@/domain/types";

const po = (n: string) => PURCHASE_ORDERS.find((p) => p.poNumber === n)!;
const grns = (n: string) => GOODS_RECEIPTS.filter((g) => g.poNumber === n);
const total = (lines: NetLine[]) => lines.reduce((s, l) => s + l.amountCents, 0);
const run = (lines: NetLine[], p: PurchaseOrder, policy: Policy = DEFAULT_POLICY, totalCents = total(lines)) =>
  match(lines, totalCents, p, grns(p.poNumber), policy);
const rules = (r: ReturnType<typeof run>) => r.hits.map((h) => h.rule);
const holds = (r: ReturnType<typeof run>) => r.hits.filter((h) => h.outcome === "HOLD").map((h) => h.rule);

const acme = makeNetLines([["A4 copy paper, 10-ream case", 20, 4250], ["Ballpoint pens, box of 50", 10, 1899], ["Desk organizer", 5, 2400]]);
const ec1 = makeNetLines([["Managed support hours", 140, 12500, "service"]]);
const pv = makeNetLines([["Toner cartridge, black, high-yield", 40, 2605]]);

describe("match — prices and cumulative billing", () => {
  it("passes an exact 3-way match", () => {
    const r = run(acme, po("PO-2031"));
    expect(holds(r)).toEqual([]);
    expect(r.data.lines.every((l) => l.status === "ok")).toBe(true);
    expect(r.data.invoiceSubtotalCents).toBe(115_990);
  });

  it("holds the third split invoice that overruns the PO (EC-1)", () => {
    const r = run(ec1, po("PO-2041"));
    const hit = r.hits.find((h) => h.rule === "R-PO-03")!;
    expect(hit.facts).toMatchObject({ poNumber: "PO-2041", cumulativeAfter: 4_950_000, overrunCents: 150_000, overUnits: 12, remainingUnits: 128 });
    expect(Number(hit.facts.overrunPct)).toBeCloseTo(0.03125);
    expect(rules(r)).not.toContain("R-TOL-01");
  });

  it("holds a 4.2% supplier price increase at the default 2% tolerance (PV)", () => {
    const hit = run(pv, po("PO-2052")).hits.find((h) => h.rule === "R-TOL-01")!;
    expect(Number(hit.facts.pct)).toBeCloseTo(0.042);
    expect(hit.facts.cents).toBe(4200);
  });

  it("approves the same increase once price tolerance is 5%, but the $ limit still binds", () => {
    const at5 = run(pv, po("PO-2052"), { ...DEFAULT_POLICY, priceTolPct: 0.05 });
    expect(rules(at5)).not.toContain("R-TOL-01");
    expect(rules(at5)).toContain("R-TOL-02");
    expect(rules(run(pv, po("PO-2052"), { ...DEFAULT_POLICY, priceTolPct: 0.05, priceTolAbsCents: 4000 }))).toContain("R-TOL-01");
  });

  it("does not count a tolerated price increase as a PO overrun", () => {
    const r = run(pv, po("PO-2052"), { ...DEFAULT_POLICY, priceTolPct: 0.05 });
    expect(rules(r)).not.toContain("R-PO-03");
    expect(r.data.cumulativeAfterCents).toBe(100_000); // PO consumed at contracted prices
    expect(r.data.invoiceSubtotalCents).toBe(104_200); // what is actually billed and posted
  });

  it("never lets price tolerance cover a PO overrun", () => {
    expect(rules(run(ec1, po("PO-2041"), { ...DEFAULT_POLICY, priceTolPct: 0.05 }))).toContain("R-PO-03");
  });

  it("holds small overcharges that add up across the invoice", () => {
    const p: PurchaseOrder = { poNumber: "PO-T", vendorId: "V-ACME", matchType: "2-way", currency: "USD", status: "open", billedToDateCents: 0, totalCents: 600_000,
      lines: [1, 2, 3].map((n) => ({ lineNo: n, description: `Consulting block ${["alpha", "beta", "gamma"][n - 1]}`, quantity: 1, unitPriceCents: 200_000 })) };
    const lines = makeNetLines([["Consulting block alpha", 1, 202_000], ["Consulting block beta", 1, 202_000], ["Consulting block gamma", 1, 202_000]]);
    const r = match(lines, total(lines), p, [], DEFAULT_POLICY);
    expect(r.hits.find((h) => h.rule === "R-TOL-01")?.facts).toMatchObject({ scope: "invoice", cents: 6000 });
  });

  it("routes invoices above the approval threshold for sign-off", () => {
    expect(rules(run(acme, po("PO-2031"), DEFAULT_POLICY, 2_600_000))).toContain("R-APR-01");
  });
});

describe("match — lines that are not on the PO", () => {
  it("holds an uncontracted goods line", () => {
    const lines = [...acme, ...makeNetLines([["Laptop stand", 2, 3900]]).map((l) => ({ ...l, index: 3 }))];
    expect(holds(run(lines, po("PO-2031")))).toContain("R-LIN-01");
  });

  it("accepts freight within the allowance and holds it above", () => {
    const chair = makeNetLines([["Ergonomic office chair", 4, 28900]]);
    const ship = (c: number) => [...chair, { index: 1, description: "Shipping & handling", lineType: "freight" as const, quantity: 1, unitCents: c, amountCents: c }];
    const ok = run(ship(4500), po("PO-2034"));
    expect(ok.hits.find((h) => h.rule === "R-FRT-01")?.outcome).toBe("NOTE");
    expect(rules(ok)).not.toContain("R-LIN-01");
    expect(ok.data.invoiceSubtotalCents).toBe(115_600);
    expect(run(ship(12000), po("PO-2034")).hits.find((h) => h.rule === "R-FRT-01")?.outcome).toBe("HOLD");
  });

  it("treats a discount as favourable", () => {
    const lines = [...acme, { index: 3, description: "Loyalty discount", lineType: "discount" as const, quantity: 1, unitCents: -2500, amountCents: -2500 }];
    const r = run(lines, po("PO-2031"));
    expect(r.hits).toEqual([]);
    expect(r.findings.some((f) => f.level === "info" && /discount/i.test(f.text))).toBe(true);
  });

  it("matches a bundled line against the PO lines it covers", () => {
    const bundle = (c: number) => [{ index: 0, description: "Website refresh — project deliverable", lineType: "service" as const, quantity: 1, unitCents: c, amountCents: c }];
    const r = run(bundle(350_000), po("PO-2095"));
    expect(r.hits.map((h) => [h.rule, h.outcome])).toEqual([["R-BUN-01", "NOTE"]]);
    expect(r.data.lines[0].status).toBe("bundled");
    const off = run(bundle(380_000), po("PO-2095")); // $300 over: not a bundle — uncontracted, and it overruns the PO
    expect(holds(off)).toContain("R-LIN-01");
    expect(rules(off)).not.toContain("R-BUN-01");
  });
});

describe("match — receipts", () => {
  it("holds billing beyond what was received", () => {
    const over = makeNetLines([["A4 copy paper, 10-ream case", 25, 4250]]);
    expect(holds(run(over, po("PO-2031")))).toContain("R-GRN-01");
  });

  it("asks whether goods arrived when no receipt exists", () => {
    const r = run(makeNetLines([["Glossy A3 paper, ream", 30, 1650]]), po("PO-2058"));
    expect(holds(r)).toEqual(["R-GRN-02"]);
  });
});
