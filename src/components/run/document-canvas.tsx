"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronDown, Minus, Plus } from "lucide-react";
import type { InboxRow } from "@/pipeline/ports";
import type { Box } from "@/domain/types";
import { Mono } from "@/components/primitives";

// Must be set in the module that renders <Document>. Copied to /public by the postinstall script.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface Highlight { page: number; box?: Box; label: string }

export default function DocumentCanvas({ documentId, envelope, kind, focus, highlights }: {
  documentId: string; envelope: InboxRow | null; kind: "digital" | "scanned" | null; focus: number; highlights: Highlight[];
}) {
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [showEmail, setShowEmail] = useState(false);
  const width = Math.round(560 * zoom);

  return (
    <section className="flex h-full min-h-0 flex-col border-r border-border bg-canvas">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-white px-4 text-xs text-ink-2">
        {envelope ? (
          <button type="button" onClick={() => setShowEmail((v) => !v)} className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-surface-2">
            Email envelope <ChevronDown className="size-3.5" />
          </button>
        ) : (
          <span className="px-1.5">Uploaded document</span>
        )}
        <span className="h-4 w-px bg-border" />
        <span>Source: {kind === "scanned" ? "scanned PDF" : kind === "digital" ? "digital PDF" : "—"}</span>
        <span className="h-4 w-px bg-border" />
        <Mono className="text-ink-2">Page {Math.min(focus, pages || 1)}/{pages || "–"}</Mono>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))} className="rounded p-1 hover:bg-surface-2"><Minus className="size-3.5" /></button>
          <Mono className="w-10 text-center">{Math.round(zoom * 100)}%</Mono>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.8, z + 0.15))} className="rounded p-1 hover:bg-surface-2"><Plus className="size-3.5" /></button>
        </span>
      </div>
      {showEmail && envelope && (
        <div className="shrink-0 space-y-1 border-b border-border bg-white px-5 py-3 text-[13px]">
          <div><span className="text-ink-3">From </span><span className="text-ink">{envelope.from}</span></div>
          <div><span className="text-ink-3">Subject </span><span className="text-ink">{envelope.subject}</span></div>
          <p className="pt-1 text-ink-2">{envelope.body}</p>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <Document
          file={`/api/documents/${documentId}`}
          onLoadSuccess={(d) => setPages(d.numPages)}
          loading={<div className="mx-auto h-[720px] w-[560px] animate-pulse bg-white shadow-sm" />}
          error={<div className="p-6 text-[13px] text-ink-3">This document can't be previewed.</div>}
        >
          {Array.from({ length: pages }, (_, i) => (
            <div key={i} id={`pdf-page-${i + 1}`} className="relative mx-auto mb-5 w-fit bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.04)]">
              <Page pageNumber={i + 1} width={width} renderTextLayer={false} renderAnnotationLayer={false} />
              {highlights
                .filter((h) => h.page === i + 1 && h.box && validBox(h.box))
                .map((h, j) => {
                  const [y0, x0, y1, x1] = h.box!;
                  return (
                    <div
                      key={j}
                      title={h.label}
                      className="pointer-events-none absolute rounded-sm border border-st-amber-dot/70 bg-st-amber-dot/15"
                      style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` }}
                    />
                  );
                })}
            </div>
          ))}
        </Document>
      </div>
    </section>
  );
}

const validBox = ([y0, x0, y1, x1]: Box) => [y0, x0, y1, x1].every((v) => v >= 0 && v <= 1000) && y1 - y0 >= 5 && x1 - x0 >= 5;
