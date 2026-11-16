import { describe, expect, it, vi } from "vitest";
import { initialReveal, revealReducer } from "@/components/run/reveal-reducer";
import { streamRun } from "@/lib/run-stream";
import { actionsFor } from "@/lib/actions";
import { encodeSse } from "@/server/sse";
import type { RunEvent, StageId } from "@/domain/types";

let seq = 0;
const e = (stage: StageId, type: RunEvent["type"]): RunEvent => ({ runId: "r", seq: ++seq, stage, type, at: "" });
const stageEvents = (stage: StageId) => [e(stage, "started"), e(stage, "finding"), e(stage, "completed")];

describe("revealReducer", () => {
  const events = [...stageEvents("intake"), ...stageEvents("inspect"), ...stageEvents("extract"), e("act", "done")];

  it("reveals one stage per dwell period, findings and completion with their stage", () => {
    let s = revealReducer(initialReveal(300), { type: "enqueue", events });
    s = revealReducer(s, { type: "tick", now: 0 });
    expect(s.shown.map((x) => `${x.stage}:${x.type}`)).toEqual(["intake:started", "intake:finding", "intake:completed"]);
    s = revealReducer(s, { type: "tick", now: 100 });
    expect(s.shown).toHaveLength(3);
    s = revealReducer(s, { type: "tick", now: 300 });
    expect(s.shown.at(-1)).toMatchObject({ stage: "inspect", type: "completed" });
    expect(s.shown.some((x) => x.type === "done")).toBe(false);
    s = revealReducer(s, { type: "tick", now: 600 });
    expect(s.shown.at(-1)!.type).toBe("done");
    expect(s.queue).toHaveLength(0);
  });

  it("can be reset to replay a run from the start", () => {
    let s = revealReducer(initialReveal(300), { type: "enqueue", events });
    s = revealReducer(s, { type: "flush" });
    s = revealReducer(s, { type: "reset" });
    expect(s.shown).toEqual([]);
    expect(revealReducer(s, { type: "enqueue", events }).queue).toHaveLength(events.length);
  });

  it("keeps the order when events arrive in several batches", () => {
    let s = revealReducer(initialReveal(0), { type: "enqueue", events: events.slice(0, 4) });
    s = revealReducer(s, { type: "enqueue", events: events.slice(4) });
    s = revealReducer(s, { type: "tick", now: 0 });
    expect(s.shown.map((x) => x.seq)).toEqual(events.map((x) => x.seq));
  });
});

describe("streamRun", () => {
  it("delivers every event even when one is split across chunks", async () => {
    const all = [e("intake", "started"), e("intake", "completed"), e("act", "done")];
    const text = all.map(encodeSse).join("");
    const cut = Math.floor(text.length / 2);
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(text.slice(0, cut)));
        c.enqueue(enc.encode(text.slice(cut)));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-type": "text/event-stream" } })));
    const got: RunEvent[] = [];
    await streamRun({ inboxMessageId: "m" }, (evs) => got.push(...evs));
    expect(got.map((x) => x.seq)).toEqual(all.map((x) => x.seq));
    vi.unstubAllGlobals();
  });
});

describe("actionsFor", () => {
  const ids = (o: Parameters<typeof actionsFor>[0], ctx = { hasDraftEmail: true, isDuplicate: false }) => actionsFor(o, ctx).map((a) => a.id);

  it("offers resolution actions for a held invoice", () => {
    expect(ids("HOLD")).toEqual(["approve", "query", "reject", "rerun"]);
    expect(actionsFor("HOLD", { hasDraftEmail: true, isDuplicate: false })[0]).toMatchObject({ label: "Approve & post", needsReason: true });
    expect(ids("HOLD", { hasDraftEmail: false, isDuplicate: false })).not.toContain("query");
  });

  it("offers sign-off for pending invoices", () => {
    expect(ids("ROUTE_FOR_APPROVAL")).toEqual(["sign_off", "reject"]);
  });

  it("offers override and re-run for rejected invoices", () => {
    expect(ids("REJECT", { hasDraftEmail: false, isDuplicate: true })).toEqual(expect.arrayContaining(["override", "rerun"]));
  });

  it("offers the ledger entry and re-run for approved invoices", () => {
    expect(ids("APPROVE")).toEqual(["ledger", "rerun"]);
  });
});
