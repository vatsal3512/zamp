"use client";

import { DataTable, Eyebrow, Money, Mono } from "@/components/primitives";
import { useApi } from "@/lib/use-api";
import type { GoodsReceipt, PurchaseOrder, Vendor } from "@/domain/types";
import { cn } from "@/lib/utils";

export function VendorsView() {
  const { data } = useApi<{ vendors: Vendor[]; purchaseOrders: PurchaseOrder[]; goodsReceipts: GoodsReceipt[] }>("/api/master-data");
  const vendorName = (id: string) => data?.vendors.find((v) => v.id === id)?.legalName ?? id;
  return (
    <div className="min-h-full bg-white">
      <header className="flex h-12 items-center justify-between border-b border-border px-5">
        <h1 className="text-[15px] font-semibold text-ink">POs &amp; vendors</h1>
        <span className="text-xs text-ink-3">Simulated ERP master data · read-only</span>
      </header>
      <Section title={`Purchase orders (${data?.purchaseOrders.length ?? 0})`}>
        <DataTable
          columns={[
            { key: "n", header: "PO", render: (p: PurchaseOrder) => <Mono className="text-ink">{p.poNumber}</Mono> },
            { key: "v", header: "Vendor", render: (p) => <span className="text-ink">{vendorName(p.vendorId)}</span> },
            { key: "m", header: "Match", render: (p) => <span className="text-ink-2">{p.matchType}</span> },
            { key: "s", header: "Status", render: (p) => <span className={cn(p.status === "open" ? "text-ink-2" : "text-st-amber")}>{p.status}</span> },
            { key: "t", header: "Total", align: "right", render: (p) => <Money cents={p.totalCents} /> },
            {
              key: "b", header: "Billed to date", align: "right", render: (p) => {
                const f = Math.min(1, p.billedToDateCents / p.totalCents);
                return (
                  <span className="flex items-center justify-end gap-3">
                    <span className="h-1 w-20 rounded-full bg-surface-2"><span className={cn("block h-1 rounded-full", f >= 1 ? "bg-st-amber-dot" : "bg-ink/70")} style={{ width: `${f * 100}%` }} /></span>
                    <Money cents={p.billedToDateCents} />
                  </span>
                );
              },
            },
          ]}
          rows={data?.purchaseOrders ?? []}
          rowKey={(p) => p.poNumber}
        />
      </Section>
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] divide-x divide-border">
        <Section title={`Vendors (${data?.vendors.length ?? 0})`}>
          <DataTable
            columns={[
              { key: "n", header: "Vendor", render: (v: Vendor) => <span className="text-ink">{v.legalName}</span> },
              { key: "s", header: "Status", render: (v) => <span className={cn(v.status === "approved" ? "text-st-emerald" : "text-st-crimson")}>{v.status}</span> },
              { key: "d", header: "Email domain", render: (v) => <Mono className="text-ink-2">{v.emailDomain}</Mono> },
              { key: "b", header: "Bank", render: (v) => <Mono className="text-ink-2">••{v.bankAccount.replace(/\D/g, "").slice(-4)}</Mono> },
            ]}
            rows={data?.vendors ?? []}
            rowKey={(v) => v.id}
          />
        </Section>
        <Section title={`Goods receipts (${data?.goodsReceipts.length ?? 0})`}>
          <DataTable
            columns={[
              { key: "g", header: "GRN", render: (g: GoodsReceipt) => <Mono className="text-ink">{g.grnNumber}</Mono> },
              { key: "p", header: "PO", render: (g) => <Mono className="text-ink-2">{g.poNumber}</Mono> },
              { key: "r", header: "Received", render: (g) => <span className="text-ink-2 tabular">{g.receivedAt}</span> },
              { key: "q", header: "Units", align: "right", render: (g) => <span className="tabular">{g.lines.reduce((s, l) => s + l.quantityReceived, 0)}</span> },
            ]}
            rows={data?.goodsReceipts ?? []}
            rowKey={(g) => g.grnNumber}
          />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border">
      <div className="flex h-10 items-center border-b border-border bg-surface-2 px-5"><Eyebrow>{title}</Eyebrow></div>
      {children}
    </section>
  );
}
