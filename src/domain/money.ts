import type { Cents } from "./types";
export type { Cents };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Decimal dollars → integer cents, rounding half away from zero. */
export function toCents(n: number): Cents {
  const scaled = Math.round(Math.abs(n) * 100 * 1e6) / 1e6; // strip float noise first
  return Math.sign(n) * Math.round(scaled);
}

export function formatUsd(c: Cents): string {
  return usd.format(c / 100);
}

/** "+$1,500.00" / "−$42.00" (U+2212 minus). */
export function formatSignedUsd(c: Cents): string {
  if (c < 0) return `−${usd.format(-c / 100)}`;
  return `+${usd.format(c / 100)}`;
}

/** part / whole as a fraction (0.042 = 4.2%). */
export function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

export function formatPct(f: number, digits = 1): string {
  return `${(f * 100).toFixed(digits)}%`;
}
