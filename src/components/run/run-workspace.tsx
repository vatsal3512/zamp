"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, RefreshCw, Check, ChevronRight, CircleAlert, CircleDashed, Info, Loader2, Play, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { useRun, type RunSource, type RunView, type StageView } from "./use-run";
import type { Highlight } from "./document-canvas";
import { Eyebrow, Money, Mono, RuleChip, StatusPill, ToneDot } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { actionsFor, type Action } from "@/lib/actions";
import { STATUS_META, TONE } from "@/lib/status";
import { useApi, useRefresh } from "@/lib/use-api";
import { decisionDiff } from "@/lib/decision-diff";
import { formatPct } from "@/domain/money";
import type { Finding, Outcome, Policy } from "@/domain/types";
import type { RunDetail } from "@/pipeline/ports";
import { cn } from "@/lib/utils";

const DocumentCanvas = dynamic(() => import("./document-canvas"), { ssr: false });

export function RunWorkspace({ source }: { source: RunSource }) {
  const { view, detail, error, runId, reloadDetail, replay, playing } = useRun(source);
  const [focus, setFocus] = useState(1);
  const [logOpen, setLogOpen] = useState(false);
  const documentId = view.documentId ?? detail?.run.documentId ?? null;
  const inv = view.invoice;
  const outcome = view.done ? (view.failed ? "FAILED" : view.decision?.outcome ?? null) : null;

  const highlights: Highlight[] = inv
    ? (["invoiceNumber", "total", "bankAccount", "poNumber"] as const)
        .map((k) => ({ page: inv[k].page ?? 1, box: inv[k].box, label: k }))
        .filter((h) => h.box)
    : [];

  if (error && !view.stages.length) {
    return (
      <div className="grid h-full place-items-center">
        <div className="max-w-sm text-center">
          <CircleAlert className="mx-auto size-6 text-st-crimson" />
          <div className="mt-3 text-[15px] font-medium text-ink">Couldn&apos;t open this run</div>
          <p className="mt-1 text-[13px] text-ink-2">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[minmax(0,45fr)_minmax(0,55fr)] overflow-hidden">
      {documentId || source.kind === "live" ? (
        documentId ? (
          <DocumentCanvas documentId={documentId} envelope={detail?.envelope ?? null} kind={view.kind} focus={focus} highlights={highlights} />
        ) : (
          <section className="grid place-items-center border-r border-border bg-canvas text-[13px] text-ink-3">Loading document…</section>
        )
      ) : (
        <section className="border-r border-border bg-canvas" />
      )}

      <section className="flex h-full min-h-0 min-w-0 flex-col">
        <InspectorHeader view={view} outcome={outcome} detail={detail?.run ?? null} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!view.done || logOpen ? (
            <ActivityLog view={view} onFocusPage={(p) => { setFocus(p); document.getElementById(`pdf-page-${p}`)?.scrollIntoView({ behavior: "smooth" }); }} />
          ) : null}
          {view.done && (
            <ActivitySummary view={view} open={logOpen} onToggle={() => setLogOpen((v) => !v)} onReplay={detail ? replay : undefined} playing={playing} />
          )}
          <AnimatePresence>
            {view.done && !logOpen && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                {detail?.run.rerunOf && view.decision && <RerunBanner rerunOf={detail.run.rerunOf} decision={view.decision} />}
                {view.failed ? <FailedBanner view={view} /> : <DecisionBanner view={view} detail={detail?.run ?? null} />}
                {view.lines.length > 0 && <MatchGrid view={view} />}
                {view.decision?.email && <EmailPreview email={view.decision.email} />}
                <AuditTrail view={view} detail={detail?.run ?? null} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {view.done && !view.failed && view.decision && runId && (
          <ActionBar runId={runId} view={view} detail={detail?.run ?? null} onDone={reloadDetail} />
        )}
        {view.done && view.failed && runId && <RerunOnlyBar runId={runId} />}
      </section>
    </div>
  );
}

function InspectorHeader({ view, outcome, detail }: { view: RunView; outcome: Outcome | "FAILED" | null; detail: RunDetail | null }) {
  const inv = view.invoice;
  const total = inv?.total.value != null ? Math.round(inv.total.value * 100) : null;
  const currency = (inv?.currency.value ?? "USD").toUpperCase();
  return (
    <header className="flex h-[68px] shrink-0 items-center gap-4 border-b border-border bg-white px-6">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-ink">{view.vendor?.legalName ?? inv?.vendorName.value ?? (view.stages.length ? "Reading invoice…" : "Starting…")}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
          <Mono className="text-ink-2">{inv?.invoiceNumber.value ?? "—"}</Mono>
          {view.po && <>· <Mono>{view.po.poNumber}</Mono></>}
          {detail?.source === "rerun" && <>· re-run</>}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[22px] leading-none font-semibold tracking-tight text-ink tabular">
          {total == null ? "—" : currency === "USD" ? <Money cents={total} /> : `${currency} ${(total / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
        </div>
      </div>
      <StatusPill
        outcome={detail?.override && detail.override.action !== "query_sent" ? (detail.override.action === "reject" ? "REJECT" : "APPROVE") : outcome}
        size="lg"
        label={detail?.override ? (detail.override.action === "query_sent" ? "Vendor queried" : `Resolved · ${detail.override.action.replace("_", " ")}`) : undefined}
      />
    </header>
  );
}

const LEVEL_ICON: Record<Finding["level"], { icon: typeof Check; cls: string }> = {
  ok: { icon: Check, cls: "text-st-emerald" },
  info: { icon: Info, cls: "text-ink-3" },
  warn: { icon: AlertTriangle, cls: "text-st-amber" },
  error: { icon: X, cls: "text-st-crimson" },
};

function ActivityLog({ view, onFocusPage }: { view: RunView; onFocusPage: (p: number) => void }) {
  return (
    <div className="border-b border-border">
      <div className="flex h-10 items-center justify-between border-b border-border bg-surface-2 px-6">
        <Eyebrow>Agent activity log</Eyebrow>
        <Mono className="text-ink-3">{view.model ? `${view.model}${view.cached ? " · cached" : ""}` : ""}</Mono>
      </div>
      <ol className="divide-y divide-border">
        <AnimatePresence initial={false}>
          {view.stages.map((s) => (
            <motion.li key={s.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
              <ActivityStep stage={s} view={view} onFocusPage={onFocusPage} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}

function ActivityStep({ stage, view, onFocusPage }: { stage: StageView; view: RunView; onFocusPage: (p: number) => void }) {
  const [open, setOpen] = useState(false);
  const worst = stage.findings.some((f) => f.level === "error") ? "crimson" : stage.findings.some((f) => f.level === "warn") ? "amber" : "emerald";
  const hasEvidence = stage.id === "extract" && view.invoice;
  return (
    <div className="px-6 py-2.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left">
        {stage.status === "running" ? <Loader2 className="size-4 animate-spin text-ink-3" />
          : stage.status === "failed" ? <X className="size-4 text-st-crimson" />
          : <ToneDot tone={worst} />}
        <span className="flex-1 text-[13px] font-medium text-ink">{stage.label}</span>
        {stage.hits.filter((h) => h.outcome !== "NOTE").map((h) => <RuleChip key={h.rule} rule={h.rule} />)}
        <Mono className="w-20 text-right text-ink-3">{stage.status === "running" ? "…" : fmtMs(stage.durationMs, stage.id === "extract" && view.cached)}</Mono>
        <ChevronRight className={cn("size-3.5 text-ink-3 transition-transform", open && "rotate-90")} />
      </button>
      <ul className="mt-1 space-y-0.5 pl-7">
        {stage.retrying.map((r, i) => (
          <li key={`r${i}`} className="flex items-center gap-2 text-[13px] text-st-amber"><CircleDashed className="size-3.5 animate-spin" />{r}</li>
        ))}
        {(open ? stage.findings : stage.findings.slice(0, 3)).map((f, i) => {
          const L = LEVEL_ICON[f.level];
          return (
            <li key={i} className="flex items-start gap-2 text-[13px] text-ink-2">
              <L.icon className={cn("mt-0.5 size-3.5 shrink-0", L.cls)} />
              <span>{f.text}</span>
            </li>
          );
        })}
        {!open && stage.findings.length > 3 && <li className="text-xs text-ink-3">+{stage.findings.length - 3} more</li>}
        {stage.error && <li className="text-[13px] text-st-crimson">{stage.error}</li>}
      </ul>
      {open && hasEvidence && <FieldEvidence view={view} onFocusPage={onFocusPage} />}
    </div>
  );
}

function FieldEvidence({ view, onFocusPage }: { view: RunView; onFocusPage: (p: number) => void }) {
  const inv = view.invoice!;
  const fields = [
    ["Invoice no.", "invoiceNumber"], ["Invoice date", "invoiceDate"], ["Vendor", "vendorName"], ["Bill to", "billTo"],
    ["PO reference", "poNumber"], ["Subtotal", "subtotal"], ["Tax", "taxTotal"], ["Total", "total"], ["Bank account", "bankAccount"],
  ] as const;
  return (
    <div className="mt-2 ml-7 border border-border">
      {fields.map(([label, key]) => {
        const f = inv[key];
        const check = view.quoteChecks.find((q) => q.field === key);
        return (
          <button key={key} type="button" onClick={() => f.page && onFocusPage(f.page)} className="flex h-8 w-full items-center gap-3 border-b border-border px-3 text-left last:border-b-0 hover:bg-surface-2">
            <span className="w-28 text-xs text-ink-3">{label}</span>
            <span className="flex-1 truncate text-[13px] text-ink">{f.value === null ? <span className="text-ink-3">not printed</span> : String(f.value)}</span>
            {f.quote && (check ? (
              <span className={cn("text-[11px]", check.found ? "text-st-emerald" : "text-st-amber")}>{check.found ? "verified on page" : "not found on page"}</span>
            ) : <span className="text-[11px] text-ink-3">scan · p.{f.page ?? "?"}</span>)}
            <Mono className="w-10 text-right text-ink-3">{f.value === null ? "" : f.confidence.toFixed(2)}</Mono>
          </button>
        );
      })}
    </div>
  );
}

function ActivitySummary({ view, open, onToggle, onReplay, playing }: { view: RunView; open: boolean; onToggle: () => void; onReplay?: () => void; playing: boolean }) {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-border bg-surface-2 px-6 text-[13px]">
      <button type="button" onClick={onToggle} className="flex flex-1 items-center gap-2 text-left text-ink-2 hover:text-ink">
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        <span className="font-medium text-ink">Agent activity log</span>
        <Mono className="text-ink-3">· {view.stages.length} steps · {fmtMs(view.totalMs)}{view.model ? ` · ${view.model}` : ""}{view.cached ? " · cached" : ""}</Mono>
      </button>
      {onReplay && (
        <button type="button" disabled={playing} onClick={onReplay} className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink disabled:opacity-50">
          <Play className="size-3" /> Replay
        </button>
      )}
    </div>
  );
}

function DecisionBanner({ view, detail }: { view: RunView; detail: RunDetail | null }) {
  const d = view.decision!;
  const tone = STATUS_META[d.outcome].tone;
  const binding = d.hits.filter((h) => h.outcome !== "NOTE");
  return (
    <div className={cn("border-b border-l-[3px] border-border px-6 py-5", TONE[tone].edge)}>
      <div className="flex items-start gap-3">
        {d.paymentBlocked ? <ShieldAlert className="mt-0.5 size-5 text-st-crimson" /> : <ToneDot tone={tone} />}
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold text-ink">{d.summary}</div>
          {d.owner && d.outcome !== "APPROVE" && <div className="mt-0.5 text-xs text-ink-3">Owner: {d.owner}</div>}
          <ul className="mt-3 space-y-1.5">
            {d.reasons.map((r, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-ink-2">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" />
                {r}
              </li>
            ))}
          </ul>
          {d.question && (
            <div className="mt-4 rounded-md border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink">
              <span className="mr-1.5 font-semibold">?</span>{d.question}
            </div>
          )}
          {d.paymentBlocked && <div className="mt-3 text-[13px] font-medium text-st-crimson">Payment blocked until verified.</div>}
          {binding.length + d.hits.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">{d.hits.map((h) => <RuleChip key={h.rule} rule={h.rule} />)}</div>
          )}
          {detail?.override && (
            <div className="mt-4 text-[13px] text-ink-2">
              Resolved by reviewer — <span className="font-medium text-ink">{detail.override.action.replace("_", " ")}</span>: “{detail.override.reason}”
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RerunBanner({ rerunOf, decision }: { rerunOf: string; decision: NonNullable<RunView["decision"]> }) {
  const prev = useApi<{ run: RunDetail }>(`/api/runs/${rerunOf}`);
  const policy = useApi<Policy>("/api/policy");
  if (!prev.data?.run.decision || !policy.data) return null;
  const text = decisionDiff(prev.data.run.decision, decision, policy.data);
  return (
    <div className="flex items-center gap-2 border-b border-border bg-st-blue-bg px-6 py-2.5 text-[13px] text-st-blue">
      <RefreshCw className="size-3.5" />
      <span className="font-medium">{text ?? `Re-run against AOP v${policy.data.version}: same decision (${decision.outcome})`}</span>
    </div>
  );
}

function FailedBanner({ view }: { view: RunView }) {
  const failed = view.stages.find((s) => s.status === "failed");
  return (
    <div className="border-b border-l-[3px] border-border border-l-st-crimson-dot px-6 py-5">
      <div className="text-[16px] font-semibold text-ink">The run couldn&apos;t finish</div>
      <p className="mt-1 text-[13px] text-ink-2">{failed?.error ?? "Something went wrong."} Nothing was posted. Re-run when the service is available.</p>
    </div>
  );
}

function MatchGrid({ view }: { view: RunView }) {
  const poLine = (n: number | null) => view.po?.lines.find((l) => l.lineNo === n);
  const match = view.stages.find((s) => s.id === "match");
  const md = (match?.data ?? {}) as { cumulativeAfterCents?: number; overrunCents?: number };
  const overrun = (md.overrunCents ?? 0) > 0 && match?.hits.some((h) => h.rule === "R-PO-03");
  return (
    <div className="border-b border-border">
      <div className="flex h-10 items-center justify-between border-b border-border bg-surface-2 px-6">
        <Eyebrow>3-way match {view.po ? `· ${view.po.poNumber} (${view.po.matchType})` : ""}</Eyebrow>
        {view.grns.length > 0 && <Mono className="text-ink-3">{view.grns.map((g) => g.grnNumber).join(", ")}</Mono>}
      </div>
      <table className="w-full table-fixed text-[13px]">
        <colgroup>
          <col />
          <col className="w-[76px]" />
          <col className="w-[80px]" />
          <col className="w-[62px]" />
          <col className="w-[96px]" />
          <col className="w-[104px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-border">
            {["Item", "Ordered", "Received", "Billed", "Unit price", "Variance"].map((h, i) => (
              <th key={h} className={cn("h-8 px-3 text-[11px] font-medium tracking-wider whitespace-nowrap text-ink-3 uppercase", i === 0 ? "pl-6 text-left" : "text-right", i === 5 && "pr-6")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {view.lines.map((l) => {
            const net = view.netLines.find((n) => n.index === l.invoiceLine);
            const pl = poLine(l.poLineNo);
            const priceBad = l.status === "price";
            const qtyBad = l.status === "qty";
            return (
              <tr key={l.invoiceLine} className="h-10">
                <td className={cn("pl-6 pr-4", l.status === "unmatched" && TONE.crimson.cell)}>
                  <div className="truncate text-ink" title={net?.description}>{net?.description ?? `Line ${l.invoiceLine + 1}`}</div>
                  {l.status !== "ok" && l.status !== "price" && l.status !== "qty" && <div className="text-[11px] text-ink-3">{l.status === "unmatched" ? "not on the PO" : l.status}</div>}
                </td>
                <td className="px-3 text-right tabular text-ink-2">{pl?.quantity ?? "—"}</td>
                <td className={cn("px-3 text-right tabular text-ink-2", qtyBad && TONE.amber.cell)}>{l.receivedQty ?? "—"}</td>
                <td className={cn("px-3 text-right tabular text-ink", qtyBad && TONE.amber.cell)}>{l.qty}</td>
                <td className={cn("px-3 text-right", priceBad && TONE.amber.cell)} title={priceBad ? "R-TOL-01: over the price tolerance" : undefined}>
                  <Money cents={l.invUnitCents} />
                  {l.poUnitCents != null && l.poUnitCents !== l.invUnitCents && <div className="text-[11px] text-ink-3">PO <Money cents={l.poUnitCents} /></div>}
                </td>
                <td className={cn("pr-6 pl-3 text-right", priceBad && TONE.amber.cell)}>
                  {l.priceVarCents == null || l.priceVarCents === 0 ? <span className="text-ink-3">—</span> : (
                    <>
                      <Money cents={l.priceVarCents} signed />
                      {l.priceVarPct != null && <div className="text-[11px] tabular">{l.priceVarPct >= 0 ? "+" : "−"}{formatPct(Math.abs(l.priceVarPct))}</div>}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {view.po && md.cumulativeAfterCents != null && (
        <div className={cn("flex h-10 items-center justify-between border-t border-border px-6 text-[13px]", overrun && TONE.amber.cell)}>
          <span className="text-ink-2">PO consumption after this invoice</span>
          <span><Money cents={md.cumulativeAfterCents} /> <span className="text-ink-3">of</span> <Money cents={view.po.totalCents} />
            {overrun && <span className="ml-2 font-medium">({formatPct((md.overrunCents ?? 0) / view.po.totalCents)} over)</span>}</span>
        </div>
      )}
    </div>
  );
}

function EmailPreview({ email }: { email: { to: string; subject: string; body: string } }) {
  return (
    <div className="border-b border-border px-6 py-4">
      <Eyebrow>Drafted vendor email</Eyebrow>
      <div className="mt-2 text-[13px] text-ink-2"><span className="text-ink-3">To </span>{email.to} · <span className="text-ink">{email.subject}</span></div>
      <p className="mt-1 line-clamp-3 text-[13px] whitespace-pre-line text-ink-3">{email.body}</p>
    </div>
  );
}

function AuditTrail({ view, detail }: { view: RunView; detail: RunDetail | null }) {
  const act = view.stages.find((s) => s.id === "act");
  const rows = [
    ...(act?.findings ?? []).map((f) => ({ who: "Agent", text: f.text })),
    ...(detail?.override ? [{ who: "Reviewer", text: `${detail.override.action.replace("_", " ")} — “${detail.override.reason}”` }] : []),
    ...(detail?.override && detail.posted && !view.stages.find((s) => s.id === "act")?.findings.some((f) => f.text.startsWith("Ledger write verified"))
      ? [{ who: "Agent", text: `Posted to ${detail.poNumber ?? "the PO"} after the reviewer's approval — ledger read-back verified` }]
      : []),
  ];
  if (!rows.length) return null;
  return (
    <div className="px-6 py-4">
      <Eyebrow>Audit trail</Eyebrow>
      <ul className="mt-2 space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex gap-3 text-[13px]"><span className="w-16 shrink-0 text-ink-3">{r.who}</span><span className="text-ink-2">{r.text}</span></li>
        ))}
      </ul>
    </div>
  );
}

function ActionBar({ runId, view, detail, onDone }: { runId: string; view: RunView; detail: RunDetail | null; onDone: () => void }) {
  const router = useRouter();
  const { bump } = useRefresh();
  const d = view.decision!;
  const [pending, setPending] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (detail?.override && detail.override.action !== "query_sent") return <RerunOnlyBar runId={runId} />;
  const actions = actionsFor(d.outcome, { hasDraftEmail: !!d.email, isDuplicate: d.primary?.rule === "R-DUP-01" });

  async function submit(a: Action, why: string) {
    setBusy(true);
    const action = a.id === "query" ? "query_sent" : a.id === "override" ? "approve" : a.id;
    const r = await fetch(`/api/runs/${runId}/override`, { method: "POST", body: JSON.stringify({ action, reason: why }), headers: { "content-type": "application/json" } });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return void toast.error(b.error ?? "Action failed");
    setPending(null);
    setReason("");
    toast.success(b.ledger ?? (action === "query_sent" ? "Vendor query marked as sent" : "Done"));
    onDone();
    bump();
  }

  function click(a: Action) {
    if (a.id === "rerun") return router.push(`/runs/live?rerunOf=${runId}`);
    if (a.id === "ledger") {
      const text = view.stages.find((s) => s.id === "act")?.findings.find((f) => f.text.startsWith("Ledger"))?.text;
      return void toast(text ?? "Not posted");
    }
    if (a.id === "sign_off") return void submit(a, "");
    setPending(a);
  }

  return (
    <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-border bg-white px-6">
      {actions.map((a) => (
        <Button key={a.id} size="lg" variant={a.variant === "primary" ? "default" : a.variant === "danger" ? "destructive" : "outline"} onClick={() => click(a)} disabled={busy}
          className={cn(a.id === "rerun" && "ml-auto")}>
          {a.label}
        </Button>
      ))}
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className={pending?.id === "query" ? "max-w-xl" : undefined}>
          <DialogHeader>
            <DialogTitle>{pending?.label}</DialogTitle>
            <DialogDescription>
              {pending?.id === "query" ? "Copy this draft into your email client. Nothing is sent from here." : "Your reason is recorded in the audit trail."}
            </DialogDescription>
          </DialogHeader>
          {pending?.id === "query" && d.email ? (
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-surface-2 p-3 text-[12px] whitespace-pre-wrap text-ink-2">
              {`To: ${d.email.to}\nSubject: ${d.email.subject}\n\n${d.email.body}`}
            </pre>
          ) : (
            <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Price increase agreed with the supplier on 11 Nov" />
          )}
          <DialogFooter>
            {pending?.id === "query" && d.email && (
              <Button variant="outline" onClick={() => navigator.clipboard.writeText(`To: ${d.email!.to}\nSubject: ${d.email!.subject}\n\n${d.email!.body}`).then(() => toast.success("Copied"))}>Copy</Button>
            )}
            <Button disabled={busy || (pending?.needsReason && reason.trim().length < 5)} onClick={() => pending && submit(pending, pending.id === "query" ? "Vendor query sent" : reason)}>
              {pending?.id === "query" ? "Mark as sent" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </footer>
  );
}

function RerunOnlyBar({ runId }: { runId: string }) {
  const router = useRouter();
  return (
    <footer className="flex h-14 shrink-0 items-center justify-end border-t border-border bg-white px-6">
      <Button size="lg" variant="outline" onClick={() => router.push(`/runs/live?rerunOf=${runId}`)}>Re-run against AOP</Button>
    </footer>
  );
}

function fmtMs(ms: number | null | undefined, cached = false): string {
  if (ms == null) return "—";
  const t = ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
  return cached ? `cached · ${t}` : t;
}
