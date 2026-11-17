"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { checkFile, uploadInChunks } from "@/lib/upload";
import { liveRunHref } from "@/lib/live-run";
import { cn } from "@/lib/utils";

export function UploadDrop() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  async function handle(file: File | undefined) {
    if (!file) return;
    const problem = checkFile(file);
    if (problem) return void toast.error(problem);
    try {
      setProgress(0);
      const { documentId } = await uploadInChunks(file, setProgress);
      router.push(liveRunHref({ document: documentId }));
    } catch (e) {
      toast.error((e as Error).message);
      setProgress(null);
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files[0]); }}
      onClick={() => input.current?.click()}
      className={cn(
        "flex h-11 cursor-pointer items-center gap-2.5 border-b border-dashed border-border px-5 text-[13px] text-ink-2 hover:bg-surface-2",
        over && "bg-surface-2",
      )}
    >
      <Upload className="size-4 text-ink-3" />
      {progress === null ? (
        <span>Drop an invoice here or <span className="font-medium text-ink underline underline-offset-2">browse</span> — PDF, JPG or PNG up to 12 MB</span>
      ) : (
        <span className="flex flex-1 items-center gap-3">
          Uploading… <span className="h-1 flex-1 rounded-full bg-surface-2"><span className="block h-1 rounded-full bg-ink" style={{ width: `${progress * 100}%` }} /></span>
        </span>
      )}
      <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
    </div>
  );
}
