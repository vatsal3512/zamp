import { describe, expect, it } from "vitest";
import { STATUS_META } from "@/lib/status";

describe("STATUS_META", () => {
  it("uses the product vocabulary", () => {
    expect(STATUS_META.APPROVE.label).toBe("Approved & posted");
    expect(STATUS_META.ROUTE_FOR_APPROVAL.label).toBe("Pending sign-off");
    expect(STATUS_META.HOLD.label).toBe("Needs attention");
    expect(STATUS_META.REJECT.label).toBe("Rejected");
  });

  it("gives every outcome its own tone", () => {
    const tones = Object.values(STATUS_META).map((m) => m.tone);
    expect(new Set(tones).size).toBe(tones.length);
  });
});
