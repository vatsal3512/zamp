"use client";

import { Check, Loader2, Minus, X } from "lucide-react";
import { STAGE_IDS, type StageId } from "@/domain/types";
import type { RunView, StageView } from "./use-run";
import { cn } from "@/lib/utils";

const SHORT: Record<StageId, string> = {
  intake: "Intake", inspect: "Inspect", extract: "AI read", validate: "Validate", vendor: "Vendor",
  po: "PO", match: "Match", duplicate: "Duplicate", decide: "Decide", act: "Act",
};
const FRAUD = new Set(["R-VEN-02", "R-VEN-03"]);

type NodeState = "pending" | "running" | "ok" | "hold" | "block" | "skipped";

function stateOf(s: StageView | undefined, runDone: boolean): NodeState {
  if (!s) return runDone ? "skipped" : "pending";
  if (s.status === "running") return "running";
  if (s.status === "failed") return "block";
  if (s.hits.some((h) => h.outcome === "REJECT" || FRAUD.has(h.rule))) return "block";
  if (s.hits.some((h) => h.outcome === "HOLD" || h.outcome === "ROUTE_FOR_APPROVAL")) return "hold";
  return "ok";
}

const DOT: Record<NodeState, string> = {
  pending: "border-border bg-white text-ink-3",
  running: "border-ink bg-white text-ink",
  ok: "border-st-emerald-dot bg-st-emerald-dot text-white",
  hold: "border-st-amber-dot bg-st-amber-dot text-white",
  block: "border-st-crimson-dot bg-st-crimson-dot text-white",
  skipped: "border-dashed border-border bg-white text-ink-3",
};
const LINE: Record<NodeState, string> = {
  pending: "bg-border", running: "bg-border", ok: "bg-st-emerald-dot", hold: "bg-st-amber-dot", block: "bg-st-crimson-dot", skipped: "bg-border",
};

/** The process map, live: every stage lights up as it executes; the ring marks where the decision was made. */
export function PipelineBar({ view, onSelect }: { view: RunView; onSelect: (id: StageId) => void }) {
  const byId = new Map(view.stages.map((s) => [s.id, s]));
  const decidedAt = view.decision?.primary ? view.stages.find((s) => s.hits.some((h) => h.rule === view.decision!.primary!.rule))?.id : undefined;
  return (
    <nav aria-label="Pipeline progress" className="shrink-0 border-b border-border bg-white px-4 pt-3 pb-2">
      <ol className="flex items-start">
        {STAGE_IDS.map((id, i) => {
          const s = byId.get(id);
          const st = stateOf(s, view.done);
          const prev = i > 0 ? stateOf(byId.get(STAGE_IDS[i - 1]), view.done) : null;
          const title = s ? `${s.label}${s.durationMs != null ? ` · ${s.durationMs < 1000 ? `${s.durationMs} ms` : `${(s.durationMs / 1000).toFixed(1)} s`}` : ""}${s.findings[0] ? ` — ${s.findings[0].text}` : ""}` : `${SHORT[id]} — ${view.done ? "not reached" : "waiting"}`;
          return (
            <li key={id} className="relative flex min-w-0 flex-1 flex-col items-center">
              {i > 0 && (
                <span className={cn("absolute top-[9px] right-1/2 left-[-50%] h-0.5 -translate-y-1/2", prev && prev !== "pending" && prev !== "running" && prev !== "skipped" ? LINE[prev] : "bg-border")} />
              )}
              <button
                type="button"
                title={title}
                disabled={!s}
                onClick={() => onSelect(id)}
                className={cn(
                  "relative z-10 grid size-[18px] place-items-center rounded-full border-2 transition-colors",
                  DOT[st],
                  decidedAt === id && "ring-2 ring-offset-2 ring-ink/70",
                  s && "cursor-pointer",
                )}
              >
                {st === "running" ? <Loader2 className="size-2.5 animate-spin" />
                  : st === "ok" ? <Check className="size-2.5" strokeWidth={3.5} />
                  : st === "block" ? <X className="size-2.5" strokeWidth={3.5} />
                  : st === "hold" ? <span className="text-[10px] leading-none font-bold">!</span>
                  : st === "skipped" ? <Minus className="size-2.5" />
                  : null}
              </button>
              <span className={cn("mt-1.5 w-full truncate text-center text-[10.5px] leading-tight", st === "pending" || st === "skipped" ? "text-ink-3" : "text-ink-2", decidedAt === id && "font-semibold text-ink")}>
                {SHORT[id]}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
