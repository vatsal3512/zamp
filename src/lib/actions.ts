import type { Outcome } from "@/domain/types";

export type ActionId = "approve" | "sign_off" | "query" | "reject" | "override" | "rerun" | "ledger";
export interface Action { id: ActionId; label: string; variant: "primary" | "secondary" | "danger"; needsReason: boolean }

/** Footer actions depend on the outcome — never offer "Approve & post" on a bill that is already posted. */
export function actionsFor(outcome: Outcome, ctx: { hasDraftEmail: boolean; isDuplicate: boolean; paymentBlocked?: boolean }): Action[] {
  const rerun: Action = { id: "rerun", label: "Re-run against AOP", variant: "secondary", needsReason: false };
  switch (outcome) {
    case "HOLD":
      // Payment blocked (bank change, spoofed sender, blocked vendor): approving is only legitimate after an
      // out-of-band check, so it is not the primary action and its label says what must have happened first.
      if (ctx.paymentBlocked) {
        return [
          { id: "approve", label: "Verified by call-back — approve…", variant: "secondary", needsReason: true },
          { id: "reject", label: "Reject", variant: "danger", needsReason: true },
          rerun,
        ];
      }
      return [
        { id: "approve", label: "Approve & post", variant: "primary", needsReason: true },
        ...(ctx.hasDraftEmail ? [{ id: "query", label: "Send vendor query", variant: "secondary", needsReason: false } as Action] : []),
        { id: "reject", label: "Reject", variant: "danger", needsReason: true },
        rerun,
      ];
    case "ROUTE_FOR_APPROVAL":
      return [
        { id: "sign_off", label: "Sign off & post", variant: "primary", needsReason: false },
        { id: "reject", label: "Reject", variant: "danger", needsReason: true },
      ];
    case "REJECT":
      return [{ id: "override", label: ctx.isDuplicate ? "Not a duplicate — override…" : "Override…", variant: "secondary", needsReason: true }, rerun];
    case "APPROVE":
      return [{ id: "ledger", label: "View ledger entry", variant: "secondary", needsReason: false }, rerun];
  }
}
