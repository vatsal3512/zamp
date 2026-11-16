"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Inbox, RotateCcw, ShieldCheck, Store } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Bills", icon: FileText, match: (p: string) => p === "/" || p.startsWith("/runs") },
  { href: "/needs-attention", label: "Needs attention", icon: Inbox, match: (p: string) => p.startsWith("/needs-attention"), badge: true },
  { href: "/vendors", label: "POs & vendors", icon: Store, match: (p: string) => p.startsWith("/vendors") },
  { href: "/aop", label: "AOP & controls", icon: ShieldCheck, match: (p: string) => p.startsWith("/aop") },
];

export function NavRail({ attentionCount, onReset }: { attentionCount?: number; onReset?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex h-full w-[208px] shrink-0 flex-col border-r border-border bg-white">
      <div className="flex h-12 items-center gap-2 border-b border-border px-4">
        <div className="grid size-5 place-items-center rounded bg-ink text-[10px] font-bold text-white">AP</div>
        <div className="text-[13px] font-semibold text-ink">Northwind AP</div>
      </div>
      <div className="flex-1 space-y-0.5 p-2">
        {NAV.map(({ href, label, icon: Icon, match, badge }) => {
          const active = match(path);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
                active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className="size-4 text-ink-3" />
              <span className="flex-1">{label}</span>
              {badge && attentionCount ? (
                <span className="rounded-full bg-st-amber-bg px-1.5 text-[11px] font-medium text-st-amber tabular">{attentionCount}</span>
              ) : null}
            </Link>
          );
        })}
      </div>
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={onReset}
          className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          <RotateCcw className="size-4 text-ink-3" />
          Reset demo data
        </button>
      </div>
    </nav>
  );
}
