"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, Eyebrow, Mono, RuleChip } from "@/components/primitives";
import { useApi, useRefresh } from "@/lib/use-api";
import { liveRunHref } from "@/lib/live-run";
import { RULE_TITLES } from "@/templates/explain";
import type { Policy, RuleId } from "@/domain/types";
import type { RunSummary } from "@/pipeline/ports";
import { BRIEF_COVERAGE } from "../../../fixtures/brief-coverage";
import { scenarioById } from "../../../fixtures/scenarios";
import { cn } from "@/lib/utils";

type Form = { priceTolPct: string; priceTolAbs: string; poOverrunPct: string; freightCap: string; approvalThreshold: string; dupReject: string; dupHold: string; dupWindowDays: string };

const toForm = (p: Policy): Form => ({
  priceTolPct: String(+(p.priceTolPct * 100).toFixed(2)), priceTolAbs: String(p.priceTolAbsCents / 100), poOverrunPct: String(+(p.poOverrunPct * 100).toFixed(2)),
  freightCap: String(p.freightCapCents / 100), approvalThreshold: String(p.approvalThresholdCents / 100),
  dupReject: String(p.dupRejectScore), dupHold: String(p.dupHoldScore), dupWindowDays: String(p.dupWindowDays),
});
const toBody = (f: Form, p: Policy) => ({
  priceTolPct: Number(f.priceTolPct) / 100, priceTolAbsCents: Math.round(Number(f.priceTolAbs) * 100), poOverrunPct: Number(f.poOverrunPct) / 100,
  freightCapCents: Math.round(Number(f.freightCap) * 100), approvalThresholdCents: Math.round(Number(f.approvalThreshold) * 100),
  dupRejectScore: Number(f.dupReject), dupHoldScore: Number(f.dupHold), dupWindowDays: Number(f.dupWindowDays),
  quoteMinSimilarity: p.quoteMinSimilarity, maxTaxRate: p.maxTaxRate,
});

const FIELDS: { key: keyof Form; label: string; help: string; unit: string; step: string }[] = [
  { key: "priceTolPct", label: "Price tolerance", help: "Unit-price drift on a contracted PO line that is accepted automatically.", unit: "%", step: "0.5" },
  { key: "priceTolAbs", label: "Price tolerance cap", help: "…and never more than this per line or across the invoice. Hold if either is exceeded.", unit: "$", step: "5" },
  { key: "poOverrunPct", label: "PO-overrun tolerance", help: "Billing beyond the PO total (at contracted prices). Separate from price tolerance.", unit: "%", step: "0.5" },
  { key: "freightCap", label: "Freight allowance", help: "Shipping/handling not on the PO is accepted up to this amount.", unit: "$", step: "10" },
  { key: "approvalThreshold", label: "Sign-off threshold", help: "Invoices above this total are routed to an approver.", unit: "$", step: "1000" },
  { key: "dupReject", label: "Duplicate — reject at score", help: "Probable duplicates are rejected and linked to the original.", unit: "", step: "0.05" },
  { key: "dupHold", label: "Duplicate — hold at score", help: "Possible duplicates are held for AP to check.", unit: "", step: "0.05" },
  { key: "dupWindowDays", label: "Duplicate window", help: "How far back to look for the same invoice from the same vendor.", unit: "days", step: "1" },
];

export function AopView() {
  const [tab, setTab] = useState<"aop" | "assumptions">("aop");
  return (
    <div className="min-h-full bg-white">
      <header className="flex h-12 items-center border-b border-border px-5">
        <h1 className="text-[15px] font-semibold text-ink">AOP &amp; controls</h1>
      </header>
      <div className="flex h-10 items-center gap-5 border-b border-border px-5">
        {(["aop", "assumptions"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cn("h-10 border-b-2 text-[13px]", tab === t ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
            {t === "aop" ? "Agent Operating Procedure" : "Assumptions & brief coverage"}
          </button>
        ))}
      </div>
      {tab === "aop" ? <AopForm /> : <Assumptions />}
    </div>
  );
}

function AopForm() {
  const router = useRouter();
  const { bump } = useRefresh();
  const policyApi = useApi<Policy>("/api/policy");
  const runsApi = useApi<{ runs: RunSummary[] }>("/api/runs");
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const p = policyApi.data;
  const [formOf, setFormOf] = useState<Policy | null>(null);
  if (p && p !== formOf) {
    setFormOf(p);
    setForm(toForm(p));
  }
  const lastRun = runsApi.data?.runs[0];

  async function save(rerun: boolean) {
    if (!p || !form) return;
    setSaving(true);
    const r = await fetch("/api/policy", { method: "PUT", body: JSON.stringify(toBody(form, p)), headers: { "content-type": "application/json" } });
    const b = await r.json();
    setSaving(false);
    if (!r.ok) return void toast.error(b.error ?? "Could not save");
    toast.success(`AOP v${b.version} saved`);
    bump();
    if (rerun && lastRun) router.push(liveRunHref({ rerunOf: lastRun.id }));
  }

  if (!p || !form) return <div className="p-5 text-[13px] text-ink-3">Loading…</div>;
  const dirty = JSON.stringify(toForm(p)) !== JSON.stringify(form);
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] divide-x divide-border">
      <section>
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-baseline gap-2"><div className="text-[14px] font-semibold text-ink">Tolerances, approval matrix and escalation rules</div><Mono className="text-ink-3">v{p.version}</Mono></div>
          <p className="mt-1 text-[13px] text-ink-2">The plain-language rules the agent runs against every invoice. Every change is versioned and recorded in the audit log.</p>
        </div>
        <div className="divide-y divide-border">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-6 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink">{f.label}</div>
                <div className="text-xs text-ink-3">{f.help}</div>
              </div>
              <div className="flex h-8 w-40 items-center rounded-md border border-border focus-within:border-ink">
                {f.unit === "$" && <span className="pl-2.5 text-ink-3">$</span>}
                <input type="number" step={f.step} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="h-full w-full bg-transparent px-2.5 text-right text-[13px] text-ink tabular outline-none" />
                {f.unit && f.unit !== "$" && <span className="pr-2.5 text-ink-3">{f.unit}</span>}
              </div>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <Button size="lg" disabled={!dirty || saving} onClick={() => save(true)}>Save &amp; re-run last invoice</Button>
          <Button size="lg" variant="outline" disabled={!dirty || saving} onClick={() => save(false)}>Save</Button>
          {lastRun && <span className="ml-2 text-xs text-ink-3">Last invoice: <Mono>{lastRun.invoiceNumber ?? lastRun.id}</Mono></span>}
        </div>
      </section>
      <section>
        <div className="flex h-10 items-center border-b border-border bg-surface-2 px-5"><Eyebrow>Escalation owners</Eyebrow></div>
        <DataTable
          columns={[
            { key: "r", header: "Rule", render: (r: [RuleId, string]) => <RuleChip rule={r[0]} /> },
            { key: "w", header: "When", render: (r) => <span className="text-ink-2">{RULE_TITLES[r[0]]}</span> },
            { key: "o", header: "Owner", render: (r) => <span className="text-ink">{r[1]}</span> },
          ]}
          rows={Object.entries(p.owners) as [RuleId, string][]}
          rowKey={(r) => r[0]}
        />
      </section>
    </div>
  );
}

function Assumptions() {
  const router = useRouter();
  const runsApi = useApi<{ runs: RunSummary[] }>("/api/runs");
  const latest = (scenarioId: string) => runsApi.data?.runs.find((r) => r.documentId === `doc-${scenarioId}`);
  return (
    <div>
      <div className="flex h-10 items-center border-b border-border bg-surface-2 px-5"><Eyebrow>Brief coverage — every PS-1 requirement, the rule that handles it, the fixture that proves it</Eyebrow></div>
      <DataTable
        columns={[
          { key: "b", header: "The brief says", render: (r: (typeof BRIEF_COVERAGE)[number]) => <span className="text-ink">{r.brief}</span> },
          { key: "h", header: "Handled by", render: (r) => <span className="text-ink-2">{r.handledBy}</span> },
          {
            key: "p", header: "Proved by", render: (r) => (
              <span className="flex flex-wrap gap-1.5 py-1.5">
                {r.scenarioIds.map((id) => {
                  const run = latest(id);
                  const s = scenarioById(id)!;
                  return (
                    run ? (
                      <Link key={id} href={`/runs/${run.id}`} className="rounded border border-border px-1.5 py-0.5 font-mono text-[12px] text-ink hover:bg-surface-2">
                        {s.tag}
                      </Link>
                    ) : (
                      <button key={id} type="button" onClick={() => router.push(liveRunHref({ inbox: `msg-${id}` }))}
                        className="rounded border border-dashed border-border px-1.5 py-0.5 font-mono text-[12px] text-ink-3 hover:text-ink">
                        {s.tag}
                      </button>
                    )
                  );
                })}
              </span>
            ),
          },
        ]}
        rows={BRIEF_COVERAGE}
        rowKey={(r) => r.brief}
      />
      <div className="grid grid-cols-2 divide-x divide-border border-t border-border">
        <section className="px-5 py-4">
          <Eyebrow>Assumptions</Eyebrow>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
            <li>All vendors, POs, receipts and invoices are synthetic; the ERP is simulated in Postgres.</li>
            <li>US entity paying in USD with US-style sales tax; other currencies are held, not converted.</li>
            <li>Gemini free tier is used for the build — Google may use those inputs, so only synthetic invoices go through it. In production: paid tier with no-training terms.</li>
            <li>The AP inbox is simulated; drafted vendor emails are never sent.</li>
            <li>PO consumption is measured at contracted prices; price drift is governed only by the price tolerance.</li>
          </ul>
        </section>
        <section className="px-5 py-4">
          <Eyebrow>Out of scope / known limitations</Eyebrow>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
            <li>Real ERP integration, payments, GL coding, multi-currency conversion, authentication.</li>
            <li>Partial deliveries billed across several invoices (receipt check is per invoice).</li>
            <li>Invoices covering several POs (the first PO is used), quantity tolerance, first-payment checks.</li>
            <li>Credit-note processing (credit notes are held for AP), invoice-splitting detection.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
