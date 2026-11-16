"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { initialReveal, revealReducer } from "./reveal-reducer";
import { streamRun } from "@/lib/run-stream";
import type { Decision, ExtractedInvoice, Finding, GoodsReceipt, NetLine, PurchaseOrder, RuleHit, RunEvent, StageId, Vendor } from "@/domain/types";
import type { InboxRow, RunDetail } from "@/pipeline/ports";
import type { LineMatch } from "@/pipeline/stages/match";
import { STAGE_IDS } from "@/domain/types";

export type RunSource = { kind: "live"; body: { inboxMessageId?: string; documentId?: string; rerunOf?: string } } | { kind: "stored"; runId: string };

export interface StageView {
  id: StageId; label: string; status: "pending" | "running" | "done" | "failed";
  durationMs?: number; findings: Finding[]; hits: RuleHit[]; retrying: string[]; error?: string; data?: Record<string, unknown>;
}
export interface RunView {
  runId: string | null; documentId: string | null; stages: StageView[]; decision: Decision | null; done: boolean; failed: boolean; totalMs: number | null;
  invoice: ExtractedInvoice | null; model: string | null; cached: boolean; kind: "digital" | "scanned" | null; pages: number | null;
  vendor: Vendor | null; po: PurchaseOrder | null; grns: GoodsReceipt[]; lines: LineMatch[]; netLines: NetLine[];
  quoteChecks: { field: string; found: boolean; score: number }[];
}

/** Fold revealed events into what the workspace renders. */
export function buildView(events: RunEvent[]): RunView {
  const stages = new Map<StageId, StageView>();
  const view: RunView = {
    runId: events[0]?.runId ?? null, documentId: null, stages: [], decision: null, done: false, failed: false, totalMs: null, invoice: null, model: null, cached: false,
    kind: null, pages: null, vendor: null, po: null, grns: [], lines: [], netLines: [], quoteChecks: [],
  };
  for (const e of events) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    if (e.type === "started") stages.set(e.stage, { id: e.stage, label: String(d.label ?? e.stage), status: "running", findings: [], hits: [], retrying: [] });
    const s = stages.get(e.stage);
    if (e.type === "finding" && s) s.findings.push(d as unknown as Finding);
    if (e.type === "retrying" && s) s.retrying.push(`${d.kind === "quota" ? "Quota reached" : "Retrying"} on key ${Number(d.key) + 1} · ${d.model}`);
    if (e.type === "completed" && s) Object.assign(s, { status: "done", durationMs: e.durationMs, hits: (d.hits as RuleHit[]) ?? [], data: d });
    if (e.type === "failed" && s) Object.assign(s, { status: "failed", durationMs: e.durationMs, error: String(d.text ?? "Failed") });
    if (e.type === "decision") view.decision = d as unknown as Decision;
    if (e.type === "done") Object.assign(view, { done: true, failed: Boolean(d.failed), totalMs: e.durationMs ?? null });
    if (e.type === "completed") {
      if (e.stage === "intake") view.documentId = (d.documentId as string) ?? null;
      if (e.stage === "inspect") Object.assign(view, { kind: d.kind ?? null, pages: d.pages ?? null });
      if (e.stage === "extract") Object.assign(view, { invoice: d.invoice ?? null, model: d.model ?? null, cached: Boolean(d.cached) });
      if (e.stage === "validate") Object.assign(view, { invoice: d.invoice ?? view.invoice, netLines: d.netLines ?? [], quoteChecks: d.quoteChecks ?? [] });
      if (e.stage === "vendor") view.vendor = (d.vendor as Vendor) ?? null;
      if (e.stage === "po") view.po = (d.po as PurchaseOrder) ?? null;
      if (e.stage === "match") Object.assign(view, { lines: d.lines ?? [], grns: d.grns ?? [], po: d.po ?? view.po });
    }
  }
  view.stages = STAGE_IDS.filter((id) => stages.has(id)).map((id) => stages.get(id)!);
  return view;
}

/** Live: start a stream and reveal it paced. Stored: load the run and show it instantly (or replay it paced). */
export function useRun(source: RunSource, minDwellMs = 300) {
  const [reveal, dispatch] = useReducer(revealReducer, minDwellMs, initialReveal);
  const [detail, setDetail] = useState<{ run: RunDetail; envelope: InboxRow | null; config: { boxes: boolean } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(source.kind === "stored" ? source.runId : null);
  const [detailTick, setDetailTick] = useState(0);
  const started = useRef(false);

  // drive the reveal clock
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      dispatch({ type: "tick", now: performance.now() });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // live stream
  useEffect(() => {
    if (source.kind !== "live" || started.current) return;
    started.current = true;
    streamRun(source.body, (events) => {
      dispatch({ type: "enqueue", events });
      const id = events[0]?.runId;
      if (id) setRunId((cur) => cur ?? id);
    }).catch((e: Error) => setError(e.message));
  }, [source]);

  // show the permanent URL once the live run has an id (outside render)
  useEffect(() => {
    if (source.kind === "live" && runId) window.history.replaceState(null, "", `/runs/${runId}`);
  }, [source.kind, runId]);

  // stored run (and refresh detail after a live run finishes or an action)
  const view = buildView(reveal.shown);
  const liveDone = source.kind === "live" && view.done;
  useEffect(() => {
    if (!runId || (source.kind === "live" && !liveDone)) return;
    fetch(`/api/runs/${runId}`, { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? "Run not found");
        setDetail(b);
        if (source.kind === "stored" && reveal.shown.length === 0 && reveal.queue.length === 0) {
          dispatch({ type: "enqueue", events: b.run.events });
          dispatch({ type: "flush" });
        }
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, liveDone, detailTick]);

  const replay = () => {
    if (!detail) return;
    dispatch({ type: "reset" });
    dispatch({ type: "enqueue", events: detail.run.events });
  };

  return { view, detail, error, runId, reloadDetail: () => setDetailTick((n) => n + 1), replay, playing: reveal.queue.length > 0 };
}
