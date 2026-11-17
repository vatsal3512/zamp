import type { Outcome } from "@/domain/types";

export type Tone = "emerald" | "blue" | "amber" | "crimson";

export const STATUS_META: Record<Outcome, { label: string; tone: Tone }> = {
  APPROVE: { label: "Approved & posted", tone: "emerald" },
  ROUTE_FOR_APPROVAL: { label: "Pending sign-off", tone: "blue" },
  HOLD: { label: "Needs attention", tone: "amber" },
  REJECT: { label: "Rejected", tone: "crimson" },
};

/** Tailwind classes per tone (pill border/bg/text, dot, tinted cell). Literal strings so Tailwind can see them. */
export const TONE = {
  emerald: { pill: "border-st-emerald-bd bg-st-emerald-bg text-st-emerald", dot: "bg-st-emerald-dot", cell: "bg-st-emerald-bg text-st-emerald", bar: "bg-st-emerald-dot", edge: "border-l-st-emerald-dot" },
  blue: { pill: "border-st-blue-bd bg-st-blue-bg text-st-blue", dot: "bg-st-blue-dot", cell: "bg-st-blue-bg text-st-blue", bar: "bg-st-blue-dot", edge: "border-l-st-blue-dot" },
  amber: { pill: "border-st-amber-bd bg-st-amber-bg text-st-amber", dot: "bg-st-amber-dot", cell: "bg-st-amber-bg text-st-amber", bar: "bg-st-amber-dot", edge: "border-l-st-amber-dot" },
  crimson: { pill: "border-st-crimson-bd bg-st-crimson-bg text-st-crimson", dot: "bg-st-crimson-dot", cell: "bg-st-crimson-bg text-st-crimson", bar: "bg-st-crimson-dot", edge: "border-l-st-crimson-dot" },
} as const;

/**
 * What the bills table shows for a run. A reviewer's resolution replaces the agent's status: an approved or
 * signed-off hold reads "Resolved · approve" (emerald), a rejected one "Resolved · reject" (crimson). A vendor query
 * leaves the hold open, so the agent's status stays.
 */
export function displayStatus(r: { outcome: Outcome | "FAILED" | null; override: { action: string } | null }): { label?: string; tone?: Tone } {
  const a = r.override?.action;
  if (a === "approve" || a === "sign_off") return { label: `Resolved · ${a === "sign_off" ? "signed off" : "approve"}`, tone: "emerald" };
  if (a === "reject") return { label: "Resolved · reject", tone: "crimson" };
  return {};
}
