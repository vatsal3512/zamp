"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Mail, Play } from "lucide-react";
import { toast } from "sonner";
import { DataTable, Eyebrow, LedgerStrip, Money, Mono, RuleChip, StatusPill, type Column } from "@/components/primitives";
import { UploadDrop } from "./upload-drop";
import { EvalCell } from "./eval-cell";
import { useApi, useRefresh } from "@/lib/use-api";
import { useAiMode, type AiMode } from "@/lib/ai-mode";
import { streamRun } from "@/lib/run-stream";
import { displayStatus, TONE } from "@/lib/status";
import { liveRunHref } from "@/lib/live-run";
import { filterRuns } from "@/domain/attention";
import { RULE_TITLES } from "@/templates/explain";
import { formatPct, formatUsd } from "@/domain/money";
import type { RuleId } from "@/domain/types";
import type { InboxRow, RunSummary } from "@/pipeline/ports";
import type { Kpis } from "@/server/kpis";
import { cn } from "@/lib/utils";

const FRAUD_RULES = new Set(["R-VEN-02", "R-VEN-03"]);
const time = (iso: string) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—");

export function BillsView({ initialTab = "all" }: { initialTab?: "all" | "attention" }) {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | "attention">(initialTab);
  const runsApi = useApi<{ runs: RunSummary[]; kpis: Kpis }>("/api/runs");
  const inboxApi = useApi<{ messages: InboxRow[] }>("/api/inbox");
  const runs = useMemo(() => runsApi.data?.runs ?? [], [runsApi.data]);
  const k = runsApi.data?.kpis;
  const shown = filterRuns(runs, { needsAttention: tab === "attention" });
  const [aiMode, setAiMode] = useAiMode();
  const { bump } = useRefresh();
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const messages = inboxApi.data?.messages ?? [];

  /**
   * Process the whole inbox, three runs at a time. Emails from the same sender run in order, so invoices that share
   * a vendor's POs and invoice history are decided in sequence, as they would arrive.
   */
  async function processAll() {
    if (batch || !messages.length) return;
    const lanes = [...Map.groupBy(messages, (m) => m.from.split("@")[1] ?? m.from).values()];
    const total = messages.length;
    let done = 0, failed = 0;
    setBatch({ done, total });
    const worker = async () => {
      for (let lane = lanes.shift(); lane; lane = lanes.shift()) {
        for (const m of lane) {
          await streamRun({ inboxMessageId: m.id, fresh: aiMode === "live" }, () => {}).catch(() => void failed++);
          setBatch({ done: ++done, total });
          runsApi.reload();
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setBatch(null);
    bump();
    if (failed) toast.error(`${failed} of ${total} runs couldn't start`);
    else toast.success(`Processed all ${total} emails`);
  }

  // Open exceptions only: a reviewer's approve / sign-off / reject closes one, matching the Needs-attention count.
  // Crimson for blocked payments (rejects, fraud signals), amber for holds a person must answer.
  const exceptions = useMemo(() => {
    const groups = new Map<string, { n: number; severe: boolean }>();
    for (const r of runs) {
      if (!r.primaryRule || r.outcome === "APPROVE" || r.outcome === "FAILED" || !r.outcome) continue;
      if (r.override && r.override.action !== "query_sent") continue;
      const g = groups.get(r.primaryRule) ?? { n: 0, severe: false };
      g.n++;
      g.severe ||= r.outcome === "REJECT" || FRAUD_RULES.has(r.primaryRule);
      groups.set(r.primaryRule, g);
    }
    return [...groups.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [runs]);
  const scale = Math.max(runs.length, 5); // a single exception reads as a small share, not a full bar

  const columns: Column<RunSummary>[] = [
    { key: "time", header: "Received", render: (r) => <span className="text-ink-3 tabular">{time(r.startedAt)}</span>, className: "w-[96px]" },
    { key: "invoice", header: "Invoice", render: (r) => <Mono className="text-ink">{r.invoiceNumber ?? "—"}</Mono> },
    { key: "vendor", header: "Vendor", render: (r) => <span className="text-ink">{r.vendorName ?? "Unknown"}</span> },
    { key: "amount", header: "Amount", align: "right", render: (r) => <Money cents={r.totalCents} className="text-ink" /> },
    { key: "status", header: "Status", render: (r) => <StatusPill outcome={r.outcome} {...displayStatus(r)} /> },
    {
      key: "reason", header: "Reason", className: "max-w-[340px]",
      render: (r) => (
        <span className="flex items-center gap-2 truncate text-ink-2">
          {r.summary?.split(" — ")[1] ?? (r.outcome === "APPROVE" ? "touchless" : "—")}
          {r.override && r.override.action !== "query_sent" && <span className="text-ink-3">· by reviewer</span>}
          {r.source === "rerun" && <Mono className="text-ink-3">re-run</Mono>}
        </span>
      ),
    },
    { key: "go", header: "", align: "right", render: () => <ArrowRight className="ml-auto size-4 text-ink-3" />, className: "w-10" },
  ];

  return (
    <div className="min-h-full bg-white">
      <header className="flex h-12 items-center justify-between border-b border-border px-5">
        <h1 className="text-[15px] font-semibold text-ink">Bills</h1>
      </header>

      <LedgerStrip
        items={[
          { label: "Processed", value: k?.processed ?? "—", sub: k ? `avg ${k.avgSeconds.toFixed(1)} s${k.liveRuns ? "" : " · cached"} · ~$${k.aiCostPerInvoiceUsd.toFixed(3)}/inv vs ~$${k.manualBenchmarkUsd.toFixed(2)} manual` : " " },
          { label: "Straight-through rate", value: k ? formatPct(k.straightThroughPct, 0) : "—", sub: "approved with no human touch" },
          { label: "Needs attention", value: k?.needsAttentionCount ?? "—", sub: k ? `${formatUsd(k.heldCents)} held` : " ", tone: k?.needsAttentionCount ? "amber" : undefined },
          { label: "Fraud & duplicates blocked", value: k ? formatUsd(k.protectedCents) : "—", sub: "bank changes · spoofed senders · duplicates" },
          { label: "Eval suite", value: <EvalCell />, sub: "scenarios decided correctly" },
        ]}
      />

      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] divide-x divide-border border-b border-border">
        <section>
          <div className="flex h-10 items-center justify-between border-b border-border bg-surface-2 px-5">
            <Eyebrow>AP inbox</Eyebrow>
            <div className="flex items-center gap-3">
              <span className="text-xs text-ink-3">{messages.length} emails · simulated</span>
              <AiModeToggle mode={aiMode} onChange={setAiMode} />
              <button
                type="button"
                onClick={processAll}
                disabled={!!batch || !messages.length}
                className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-xs font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
              >
                {batch ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                {batch ? `Processing ${batch.done}/${batch.total}` : "Process all"}
              </button>
            </div>
          </div>
          <UploadDrop />
          <ul className="max-h-[288px] divide-y divide-border overflow-y-auto">
            {(inboxApi.data?.messages ?? []).map((m) => (
              <li key={m.id} className="flex h-12 items-center gap-3 px-5 hover:bg-surface-2">
                <Mail className="size-4 shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{m.subject}</div>
                  <div className="truncate text-xs text-ink-3">{m.from}</div>
                </div>
                <Mono className="rounded border border-border px-1.5 py-0.5 text-ink-2">{m.scenarioTag}</Mono>
                <button
                  type="button"
                  onClick={() => router.push(liveRunHref({ inbox: m.id, fresh: aiMode === "live" }))}
                  className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary/85"
                >
                  Process
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="flex h-10 items-center border-b border-border bg-surface-2 px-5">
            <Eyebrow>Exceptions by type</Eyebrow>
          </div>
          {exceptions.length === 0 ? (
            <div className="px-5 py-8 text-[13px] text-ink-3">{runs.length ? "No open exceptions." : "No exceptions yet."}</div>
          ) : (
            <ul className="divide-y divide-border">
              {exceptions.map(([rule, { n, severe }]) => (
                <li key={rule} className="flex h-10 items-center gap-3 px-5">
                  <RuleChip rule={rule} />
                  <span className="w-44 truncate text-[13px] text-ink-2">{RULE_TITLES[rule as RuleId]}</span>
                  <div className="h-1.5 w-full flex-1 overflow-hidden rounded-sm bg-zinc-100">
                    <div className={cn("h-full rounded-sm", severe ? TONE.crimson.bar : TONE.amber.bar)} style={{ width: `${Math.min(100, (n / scale) * 100)}%` }} />
                  </div>
                  <span className="w-6 text-right text-[13px] text-ink tabular">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex h-10 items-center gap-5 border-b border-border px-5">
        {(["all", "attention"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn("h-10 border-b-2 text-[13px]", tab === t ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink")}
          >
            {t === "all" ? `All bills (${runs.length})` : `Needs attention (${filterRuns(runs, { needsAttention: true }).length})`}
          </button>
        ))}
      </div>
      {runsApi.loading && !runsApi.data ? (
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-10 animate-pulse bg-surface-2/60" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={shown}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/runs/${r.id}`)}
          empty={tab === "all" ? "No bills yet — process an email from the AP inbox." : "Nothing needs attention."}
        />
      )}
    </div>
  );
}

function AiModeToggle({ mode, onChange }: { mode: AiMode; onChange: (m: AiMode) => void }) {
  const opts: { id: AiMode; label: string; title: string }[] = [
    { id: "live", label: "Live AI", title: "Read every invoice with Gemini now (about 4 s). Falls back to the recorded reading only if the call fails." },
    { id: "recorded", label: "Recorded", title: "Replay the stored Gemini reading — instant and identical every time." },
  ];
  return (
    <div className="flex h-7 items-center rounded-md border border-border bg-white p-0.5 text-xs" role="radiogroup" aria-label="How invoices are read">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={mode === o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={cn("h-full rounded px-2", mode === o.id ? "bg-primary font-medium text-white" : "text-ink-2 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
