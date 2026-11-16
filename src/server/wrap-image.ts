import { PDFDocument } from "pdf-lib";

export type UploadKind = "pdf" | "jpg" | "png" | null;

export function sniff(bytes: Uint8Array): UploadKind {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf"; // %PDF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}

/** A phone photo becomes a one-page, image-only PDF — the pipeline then treats it as a scan. */
export async function wrapImageAsPdf(bytes: Uint8Array, kind: "jpg" | "png"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = kind === "jpg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  const scale = Math.min(1, 612 / img.width); // fit a Letter-width page
  const page = doc.addPage([img.width * scale, img.height * scale]);
  page.drawImage(img, { x: 0, y: 0, width: img.width * scale, height: img.height * scale });
  return doc.save();
}
