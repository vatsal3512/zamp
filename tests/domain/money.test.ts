import { describe, expect, it } from "vitest";
import { formatPct, formatSignedUsd, formatUsd, pct, toCents } from "@/domain/money";

describe("money", () => {
  it("converts decimal dollars to integer cents without float drift", () => {
    expect(toCents(1255.59)).toBe(125559);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it("formats cents as USD", () => {
    expect(formatUsd(4950000)).toBe("$49,500.00");
  });

  it("formats signed variances with a plus or a true minus sign", () => {
    expect(formatSignedUsd(150000)).toBe("+$1,500.00");
    expect(formatSignedUsd(-4200)).toBe("\u2212$42.00");
  });

  it("computes and formats percentages as fractions", () => {
    expect(pct(4200, 100000)).toBeCloseTo(0.042);
    expect(formatPct(0.0312)).toBe("3.1%");
  });
});
