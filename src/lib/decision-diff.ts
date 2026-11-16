import type { Decision, Policy, RuleId } from "@/domain/types";
import { formatPct, formatUsd } from "@/domain/money";
import { explain } from "@/templates/explain";

/** Why a re-run against a changed AOP decided differently — one sentence for the banner. Null when the outcome is unchanged. */
export function decisionDiff(before: Decision, after: Decision, policyAfter: Policy): string | null {
  if (before.outcome === after.outcome) return null;
  const head = `Decision changed: ${before.outcome} → ${after.outcome}`;
  const binding = (d: Decision) => d.hits.filter((h) => h.outcome !== "NOTE");
  const afterRules = new Set(binding(after).map((h) => h.rule));
  const beforeRules = new Set(binding(before).map((h) => h.rule));

  const removed = binding(before).find((h) => !afterRules.has(h.rule));
  if (removed) return `${head} — ${relaxed(removed.rule, removed.facts, policyAfter)}`;
  const added = binding(after).find((h) => !beforeRules.has(h.rule));
  if (added) return `${head} — ${explain(added.rule, added.facts).short} now applies`;
  return head;
}

function relaxed(rule: RuleId, facts: Record<string, string | number>, p: Policy): string {
  switch (rule) {
    case "R-TOL-01":
      return facts.scope === "invoice"
        ? `price differences now within the ${formatUsd(p.priceTolAbsCents)} tolerance`
        : `unit-price variance ${formatPct(Number(facts.pct ?? 0))} now within ${formatPct(p.priceTolPct, 0)} tolerance`;
    case "R-PO-03":
      return `PO overrun of ${formatPct(Number(facts.overrunPct ?? 0))} now within the ${formatPct(p.poOverrunPct, 0)} PO-overrun tolerance`;
    case "R-FRT-01":
      return `freight now within the ${formatUsd(p.freightCapCents)} allowance`;
    case "R-APR-01":
      return `total now below the ${formatUsd(p.approvalThresholdCents)} sign-off limit`;
    default:
      return `${explain(rule, facts).short} no longer applies`;
  }
}
