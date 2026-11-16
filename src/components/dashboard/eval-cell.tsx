"use client";

import { useState } from "react";
import { useApi } from "@/lib/use-api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, Mono, StatusPill } from "@/components/primitives";
import type { EvalResult } from "@/pipeline/eval";
import { cn } from "@/lib/utils";

/** "21/21" — every scenario run on recorded extractions (no API quota spent). Click for the breakdown. */
export function EvalCell() {
  const [open, setOpen] = useState(false);
  const { data, loading } = useApi<{ passed: number; total: number; results: EvalResult[] }>("/api/eval");
  if (loading && !data) return <span className="text-ink-3">…</span>;
  if (!data) return <span className="text-ink-3">—</span>;
  const ok = data.passed === data.total;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("underline decoration-dotted underline-offset-4", ok ? "text-st-emerald" : "text-st-crimson")}>
        {data.passed}/{data.total}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Eval suite — {data.passed}/{data.total} correct</DialogTitle>
            <DialogDescription>Every scenario runs end-to-end on recorded extractions against a fresh copy of the procurement data.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto border border-border">
            <DataTable
              columns={[
                { key: "s", header: "Scenario", render: (r) => <span className={r.pass ? "text-ink" : "text-st-crimson"}>{r.pass ? "✓" : "✗"} {r.tag}</span> },
                { key: "e", header: "Expected", render: (r) => <StatusPill outcome={r.expected} /> },
                { key: "a", header: "Actual", render: (r) => <StatusPill outcome={r.actual} /> },
                { key: "r", header: "Rules", render: (r) => <Mono className="text-ink-2">{r.rules.join(" ") || "—"}</Mono> },
              ]}
              rows={data.results}
              rowKey={(r) => r.id}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
