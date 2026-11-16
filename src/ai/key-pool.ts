export type CallErrorKind = "quota" | "model_unavailable" | "transient" | "fatal";

export interface Attempt {
  key: number;
  model: string;
  kind: CallErrorKind | "ok";
  ms: number;
}

export class AllProvidersExhaustedError extends Error {
  constructor(public attempts: Attempt[], message?: string) {
    super(message ?? `All API keys and models are exhausted after ${attempts.length} attempts`);
    this.name = "AllProvidersExhaustedError";
  }
}

function statusOf(e: unknown): number | undefined {
  if (e && typeof e === "object") {
    const s = (e as { status?: unknown; code?: unknown }).status ?? (e as { code?: unknown }).code;
    if (typeof s === "number") return s;
  }
  return undefined;
}

export function classifyError(e: unknown): CallErrorKind {
  const status = statusOf(e);
  const msg = e instanceof Error ? e.message : String(e);
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(msg)) return "quota";
  if (status === 404 || /NOT_FOUND/.test(msg)) return "model_unavailable";
  if ((status !== undefined && status >= 500) || /UNAVAILABLE|DEADLINE_EXCEEDED|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network/i.test(msg)) {
    return "transient";
  }
  return "fatal";
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Try models in order; for each model try keys in order.
 * quota → next key · model_unavailable → next model · transient → retry same key with backoff, then next key · fatal → throw.
 */
export async function callWithFallback<T>(
  keys: string[],
  models: string[],
  fn: (key: string, model: string) => Promise<T>,
  opts: { backoffMs?: number[]; onRetry?: (a: Attempt) => void; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ value: T; model: string; attempts: Attempt[] }> {
  const backoff = opts.backoffMs ?? [500, 1500];
  const sleep = opts.sleep ?? defaultSleep;
  const attempts: Attempt[] = [];

  for (const model of models) {
    keyLoop: for (let k = 0; k < keys.length; k++) {
      for (let retry = 0; ; retry++) {
        const started = Date.now();
        try {
          const value = await fn(keys[k], model);
          attempts.push({ key: k, model, kind: "ok", ms: Date.now() - started });
          return { value, model, attempts };
        } catch (e) {
          const kind = classifyError(e);
          const attempt: Attempt = { key: k, model, kind, ms: Date.now() - started };
          attempts.push(attempt);
          if (kind === "fatal") throw e;
          if (kind === "model_unavailable") break keyLoop;
          if (kind === "transient" && retry < backoff.length) {
            opts.onRetry?.(attempt);
            await sleep(backoff[retry]);
            continue;
          }
          if (kind === "quota" || kind === "transient") opts.onRetry?.(attempt);
          continue keyLoop;
        }
      }
    }
  }
  throw new AllProvidersExhaustedError(attempts);
}
