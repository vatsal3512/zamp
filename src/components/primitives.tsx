import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatPct, formatSignedUsd, formatUsd } from "@/domain/money";
import type { Outcome } from "@/domain/types";
import { STATUS_META, TONE, type Tone } from "@/lib/status";

/** 1px-bordered pill with a 6px dot. `outcome` null = neutral "Processing…" state. */
export function StatusPill({ outcome, size = "sm", label }: { outcome: Outcome | "FAILED" | null; size?: "sm" | "lg"; label?: string }) {
  const meta = outcome && outcome !== "FAILED" ? STATUS_META[outcome] : null;
  const tone = meta ? TONE[meta.tone] : null;
  const text = label ?? (outcome === "FAILED" ? "Failed" : meta?.label ?? "Processing…");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "lg" ? "px-2.5 py-1 text-[13px]" : "px-2 py-0.5 text-xs",
        tone ? tone.pill : outcome === "FAILED" ? "border-st-crimson-bd bg-white text-st-crimson" : "border-border bg-surface-2 text-ink-2",
      )}
    >
      <span className={cn("size-1.5 rounded-full", tone ? tone.dot : outcome === "FAILED" ? "bg-st-crimson-dot" : "bg-ink-3 animate-pulse")} />
      {text}
    </span>
  );
}

export function ToneDot({ tone, pulse }: { tone: Tone | "neutral"; pulse?: boolean }) {
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", tone === "neutral" ? "bg-ink-3" : TONE[tone].dot, pulse && "animate-pulse")} />;
}

/** Money in tabular sans (not mono). */
export function Money({ cents, signed, pct, className }: { cents: number | null | undefined; signed?: boolean; pct?: number; className?: string }) {
  if (cents == null) return <span className={cn("tabular text-ink-3", className)}>—</span>;
  const main = signed ? formatSignedUsd(cents) : formatUsd(cents);
  return (
    <span className={cn("tabular whitespace-nowrap", className)}>
      {main}
      {pct !== undefined && <span className="text-ink-3"> · {pct >= 0 ? "+" : "−"}{formatPct(Math.abs(pct))}</span>}
    </span>
  );
}

/** Identifiers: rule IDs, invoice/PO/GRN numbers, confidence, timings. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px] tracking-tight", className)}>{children}</span>;
}

export function RuleChip({ rule }: { rule: string }) {
  return <Mono className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-ink-2">{rule}</Mono>;
}

/** Column header label: 11px uppercase tracked. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-medium tracking-wider text-ink-3 uppercase", className)}>{children}</div>;
}

/** Top-of-page ledger: one hairline-divided row, not floating cards. */
export function LedgerStrip({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }[] }) {
  return (
    <div className="grid grid-cols-5 divide-x divide-border border-b border-border bg-white">
      {items.map((it) => (
        <div key={it.label} className="px-5 py-4">
          <Eyebrow>{it.label}</Eyebrow>
          <div className={cn("mt-1.5 text-[22px] leading-none font-semibold tracking-tight tabular", it.tone ? TONE[it.tone].pill.split(" ").find((c) => c.startsWith("text-")) : "text-ink")}>{it.value}</div>
          {it.sub && <div className="mt-1.5 text-xs text-ink-3">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export interface Column<Row> {
  key: string;
  header: string;
  align?: "left" | "right";
  className?: string;
  render: (row: Row) => ReactNode;
  tone?: (row: Row) => Tone | null;
}

/** Dense table: 40px rows, 11px uppercase headers, hairline dividers, tint only on cells that break a rule. */
export function DataTable<Row>({ columns, rows, rowKey, onRowClick, empty }: {
  columns: Column<Row>[]; rows: Row[]; rowKey: (r: Row) => string; onRowClick?: (r: Row) => void; empty?: ReactNode;
}) {
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-border bg-surface-2">
          {columns.map((c) => (
            <th key={c.key} className={cn("h-8 px-4 text-[11px] font-medium tracking-wider whitespace-nowrap text-ink-3 uppercase", c.align === "right" ? "text-right" : "text-left", c.className)}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="px-4 py-10 text-center text-ink-3">{empty ?? "Nothing here yet."}</td>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn("h-10", onRowClick && "cursor-pointer hover:bg-surface-2")}>
            {columns.map((c) => {
              const tone = c.tone?.(r);
              return (
                <td key={c.key} className={cn("px-4 align-middle", c.align === "right" && "text-right", tone && TONE[tone].cell, c.className)}>
                  {c.render(r)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
