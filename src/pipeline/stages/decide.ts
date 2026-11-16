import type { Cents, Decision, Outcome, Policy, RuleHit, RuleId, Vendor } from "@/domain/types";
import { draftEmail, explain } from "@/templates/explain";

const PRECEDENCE: Outcome[] = ["REJECT", "HOLD", "ROUTE_FOR_APPROVAL", "APPROVE"];

/** Which reason leads when several rules share the winning outcome. */
export const PRIORITY: RuleId[] = [
  "R-DOC-01", "R-DUP-01", "R-DOC-02", "R-DOC-04", "R-VEN-02", "R-VEN-03", "R-VEN-04", "R-VEN-01",
  "R-EXT-01", "R-EXT-02", "R-TAX-01", "R-DOC-03", "R-CUR-01", "R-PO-04", "R-PO-01", "R-PO-03",
  "R-LIN-01", "R-TOL-01", "R-FRT-01", "R-GRN-02", "R-GRN-01", "R-DUP-02", "R-APR-01",
  // notes last
  "R-PO-02", "R-TOL-02", "R-BUN-01",
];
const rank = (r: RuleId) => PRIORITY.indexOf(r);

export function decide(hits: RuleHit[], ctx: { policy: Policy; vendor: Vendor | null; invoiceNumber: string | null; totalCents: Cents | null }): Decision {
  const binding = hits.filter((h) => h.outcome !== "NOTE");
  const outcome = PRECEDENCE.find((o) => binding.some((h) => h.outcome === o)) ?? "APPROVE";
  const sorted = [...hits].sort((a, b) => {
    const ao = a.outcome === "NOTE" ? 1 : 0;
    const bo = b.outcome === "NOTE" ? 1 : 0;
    return ao - bo || rank(a.rule) - rank(b.rule);
  });
  const primary = outcome === "APPROVE" ? null : sorted.find((h) => h.outcome === outcome) ?? null;
  const owner = primary ? ctx.policy.owners[primary.rule] : null;
  const fraudSignals = hits.filter((h) => h.rule === "R-VEN-02" || h.rule === "R-VEN-03").length;
  const paymentBlocked = hits.some((h) => h.rule === "R-VEN-02" || h.rule === "R-VEN-03" || h.rule === "R-VEN-04");
  const reasons = sorted.map((h) => explain(h.rule, h.facts).reason);
  const primaryText = primary ? explain(primary.rule, primary.facts) : null;
  const notes = hits.length;

  let summary: string;
  if (outcome === "APPROVE") summary = notes ? `Approved — ${notes} note${notes === 1 ? "" : "s"}` : "Approved — touchless";
  else if (outcome === "ROUTE_FOR_APPROVAL") summary = `Pending sign-off — ${owner ?? "Approver"}`;
  else if (fraudSignals >= 2) summary = `Needs attention — ${fraudSignals} fraud signals · high risk`;
  else summary = `${outcome === "REJECT" ? "Rejected" : "Needs attention"} — ${primaryText!.short}`;

  const decision: Decision = {
    outcome, hits: sorted, primary, owner, summary, reasons,
    question: primaryText?.question ?? null, email: null, paymentBlocked, fraudSignals,
  };
  decision.email = outcome === "HOLD" || outcome === "REJECT" ? draftEmail(decision, ctx.vendor, ctx.invoiceNumber) : null;
  return decision;
}
