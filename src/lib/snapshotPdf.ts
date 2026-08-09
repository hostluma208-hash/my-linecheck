// Turns a high-resolution snapshot PNG into a print-friendly, paginated A4 PDF.
// The PNG is rendered at 3x, so slicing it across pages keeps text crisp.
import { buildClosingSnapshotPng, type ClosingSnapshotRecord } from "@/lib/closingSnapshot";
import { buildReceivingSnapshotPng, type ReceivingSnapshotRecord } from "@/lib/receivingSnapshot";

const A4 = { w: 595.28, h: 841.89 }; // pt
const MARGIN = 24;

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

async function pngToPdf(blob: Blob, filename: string) {
  const { jsPDF } = await import("jspdf");
  const img = await blobToImage(blob);

  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const availW = A4.w - MARGIN * 2;
  const availH = A4.h - MARGIN * 2;

  // Scale factor from image px -> pdf pt (fit width).
  const scale = availW / img.width;
  // Slice height in source pixels that fits one page.
  const sliceH = Math.floor(availH / scale);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  let offset = 0;
  let page = 0;
  while (offset < img.height) {
    const h = Math.min(sliceH, img.height - offset);
    canvas.width = img.width;
    canvas.height = h;
    ctx.fillStyle = "#f5f5f7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, offset, img.width, h, 0, 0, img.width, h);
    const data = canvas.toDataURL("image/jpeg", 0.95);
    if (page > 0) pdf.addPage();
    pdf.addImage(data, "JPEG", MARGIN, MARGIN, availW, h * scale, undefined, "FAST");
    offset += h;
    page++;
  }

  pdf.save(filename);
}

function baseName(prefix: string, date?: string, time?: string) {
  return `${prefix}-${(date || "report").replace(/[^\w-]+/g, "-")}-${(time || "").replace(
    /[^\w-]+/g,
    "",
  )}.pdf`;
}

export async function downloadClosingSnapshotPdf(r: ClosingSnapshotRecord) {
  const blob = await buildClosingSnapshotPng(r);
  if (!blob) return;
  await pngToPdf(blob, baseName("closing-report", r.date, r.time));
}

export async function downloadReceivingSnapshotPdf(r: ReceivingSnapshotRecord) {
  const blob = await buildReceivingSnapshotPng(r);
  if (!blob) return;
  await pngToPdf(blob, baseName("receiving-report", r.date, r.time));
}
