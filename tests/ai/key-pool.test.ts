import { describe, expect, it, vi } from "vitest";
import { AllProvidersExhaustedError, callWithFallback, classifyError } from "@/ai/key-pool";

const err = (status: number, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });
const instant = async () => {};

describe("classifyError", () => {
  it("maps statuses and messages to error kinds", () => {
    expect(classifyError(err(429))).toBe("quota");
    expect(classifyError(new Error("RESOURCE_EXHAUSTED: quota"))).toBe("quota");
    expect(classifyError(err(404))).toBe("model_unavailable");
    expect(classifyError(err(503))).toBe("transient");
    expect(classifyError(new Error("fetch failed"))).toBe("transient");
    expect(classifyError(err(400))).toBe("fatal");
  });
});

describe("callWithFallback", () => {
  it("moves to the next key on quota, keeping the same model", async () => {
    const fn = async (key: string) => {
      if (key === "k0") throw err(429);
      return "done";
    };
    const r = await callWithFallback(["k0", "k1"], ["m1", "m2"], fn, { sleep: instant });
    expect(r.value).toBe("done");
    expect(r.model).toBe("m1");
    expect(r.attempts.map((a) => a.kind)).toEqual(["quota", "ok"]);
  });

  it("falls to the next model when a model is unavailable for every key", async () => {
    const fn = async (_key: string, model: string) => {
      if (model === "m1") throw err(404);
      return "ok";
    };
    const r = await callWithFallback(["k0", "k1"], ["m1", "m2"], fn, { sleep: instant });
    expect(r.model).toBe("m2");
  });

  it("retries transient errors on the same key with backoff", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls <= 2) throw err(503);
      return "ok";
    };
    const onRetry = vi.fn();
    const r = await callWithFallback(["k0", "k1"], ["m1"], fn, { sleep: instant, onRetry });
    expect(r.attempts).toHaveLength(3);
    expect(r.attempts.every((a) => a.key === 0)).toBe(true);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("throws AllProvidersExhaustedError when every key and model is out of quota", async () => {
    const fn = async () => {
      throw err(429);
    };
    const p = callWithFallback(["k0", "k1", "k2"], ["m1", "m2"], fn, { sleep: instant });
    await expect(p).rejects.toBeInstanceOf(AllProvidersExhaustedError);
    const e = (await p.catch((x) => x)) as AllProvidersExhaustedError;
    expect(e.attempts).toHaveLength(6);
  });

  it("throws immediately on a fatal error", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw err(400);
    };
    await expect(callWithFallback(["k0", "k1"], ["m1"], fn, { sleep: instant })).rejects.toThrow("HTTP 400");
    expect(calls).toBe(1);
  });
});
