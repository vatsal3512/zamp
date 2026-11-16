"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { NavRail } from "./nav-rail";
import { RefreshContext } from "@/lib/use-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);
  const [attention, setAttention] = useState<number | undefined>();
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    fetch("/api/runs", { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => setAttention(b?.kpis?.needsAttentionCount))
      .catch(() => {});
  }, [path, tick]);

  async function reset() {
    setConfirm(false);
    const r = await fetch("/api/demo/reset", { method: "POST" });
    if (r.ok) {
      toast.success("Demo data restored");
      bump();
    } else toast.error("Reset failed");
  }

  return (
    <RefreshContext.Provider value={{ tick, bump }}>
      <div className="flex h-screen overflow-hidden bg-white">
        <NavRail attentionCount={attention} onReset={() => setConfirm(true)} />
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset demo data?</DialogTitle>
            <DialogDescription>
              Restores purchase orders, the AOP and invoice history to their starting state and clears all runs. The inbox and recorded extractions are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button onClick={reset}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RefreshContext.Provider>
  );
}
