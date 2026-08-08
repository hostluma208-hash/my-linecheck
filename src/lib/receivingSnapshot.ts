// Builds a self-contained PNG snapshot of a receiving record so it can be
// downloaded, archived, shared in chat apps and viewed on any device.
import { lsStore } from "@/lib/lsStore";

export type ReceivingSnapshotRecord = {
  id: string;
  date?: string;
  time?: string;
  branch?: string;
  driver?: string;
  deliveryNote?: string;
  purchaseOrder?: string;
  chillerCarTemp?: string;
  productTemp?: string;
  tempChecks?: Record<string, boolean>;
  quantityChecks?: Record<string, boolean>;
  qualityChecks?: Record<string, boolean>;
  receiverName?: string;
  signature?: string;
  comments?: string;
  checkedBy?: string;
  photos?: string[];
};

const W = 900;
const PAD = 48;
const CONTENT = W - PAD * 2;
// Render at 3x device pixels so text and photos stay crisp when zoomed/printed.
const SCALE = 3;

const INK = "#111114";
const MUTED = "#6b6b74";
const LINE = "#e4e4e9";
const BG = "#f5f5f7";
const CARD = "#ffffff";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of String(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = `${line} ${words[i]}`;
      if (ctx.measureText(next).width > maxWidth) {
        out.push(line);
        line = words[i];
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function buildReceivingSnapshotPng(
  r: ReceivingSnapshotRecord,
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const brand = lsStore.getItem("linecheck:settings:brand:name") || "LUMA";

  const groups: { title: string; items: string[]; checks: Record<string, boolean> }[] = [
    { title: "1. Temperature check", items: Object.keys(r.tempChecks || {}), checks: r.tempChecks || {} },
    { title: "2. Quantity check", items: Object.keys(r.quantityChecks || {}), checks: r.quantityChecks || {} },
    { title: "3. Quality check", items: Object.keys(r.qualityChecks || {}), checks: r.qualityChecks || {} },
  ].filter((g) => g.items.length);

  const details: [string, string][] = [
    ["Date / Time", `${r.date || "—"} ${r.time || ""}`.trim()],
    ["Branch", r.branch || ""],
    ["Driver", r.driver || ""],
    ["Delivery Note / Invoice #", r.deliveryNote || ""],
    ["Purchase Order #", r.purchaseOrder || ""],
    ["Chiller Car Temp", r.chillerCarTemp ? `${r.chillerCarTemp} °C` : ""],
    ["Product Temp", r.productTemp ? `${r.productTemp} °C` : ""],
    ["Checked by", r.checkedBy || ""],
    ["Receiver", r.receiverName || ""],
    ["Signature", r.signature || ""],
  ].filter(([, v]) => v) as [string, string][];

  const photos = (
    await Promise.all((r.photos || []).slice(0, 12).map((p) => loadImage(p)))
  ).filter(Boolean) as HTMLImageElement[];

  const m = document.createElement("canvas").getContext("2d")!;
  const body = "400 15px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

  const chips = [
    r.date || "—",
    r.time || "",
    r.branch || "",
    r.receiverName ? `Received by ${r.receiverName}` : "",
  ].filter(Boolean);

  m.font = body;
  const groupLines = groups.map((g) => g.items.map((it) => wrap(m, it, CONTENT - 80)));
  const noteLines = r.comments ? wrap(m, r.comments, CONTENT - 48) : [];

  const cols = 3;
  const gap = 12;
  const cellW = Math.floor((CONTENT - 48 - gap * (cols - 1)) / cols);
  const cellH = Math.round(cellW * 0.75);
  const photoRows = photos.length ? Math.ceil(photos.length / cols) : 0;

  let h = PAD;
  h += 22 + 40; // brand + title
  h += 24; // card top padding
  h += 40; // chips
  if (details.length) {
    h += 34;
    h += Math.ceil(details.length / 2) * 26 + 4;
  }
  groups.forEach((_g, gi) => {
    h += 34;
    h += groupLines[gi].reduce((a, l) => a + Math.max(26, l.length * 24), 0) + 4;
  });
  if (noteLines.length) {
    h += 34;
    h += noteLines.length * 24 + 4;
  }
  if (photoRows) {
    h += 34;
    h += photoRows * (cellH + gap) - gap + 4;
  }
  h += 28;
  h += 46;

  const H = Math.max(h, 420);

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  let y = PAD;
  ctx.fillStyle = MUTED;
  ctx.font = "700 12px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(brand.toUpperCase(), PAD, y);
  y += 22;
  ctx.fillStyle = INK;
  ctx.font = "700 30px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Receiving Report", PAD, y + 18);
  y += 40;

  const cardTop = y;
  const cardH = H - PAD - 46 - cardTop + 24;
  const rr = (x: number, yy: number, w: number, hh: number, rad: number) => {
    ctx.beginPath();
    ctx.moveTo(x + rad, yy);
    ctx.arcTo(x + w, yy, x + w, yy + hh, rad);
    ctx.arcTo(x + w, yy + hh, x, yy + hh, rad);
    ctx.arcTo(x, yy + hh, x, yy, rad);
    ctx.arcTo(x, yy, x + w, yy, rad);
    ctx.closePath();
  };
  ctx.fillStyle = CARD;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  rr(PAD, cardTop, CONTENT, Math.max(cardH, 120), 18);
  ctx.fill();
  ctx.stroke();

  const x0 = PAD + 24;
  y = cardTop + 24;

  let cx = x0;
  ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
  for (const c of chips) {
    const w = ctx.measureText(c).width + 24;
    if (cx + w > PAD + CONTENT - 24) {
      cx = x0;
      y += 34;
    }
    ctx.fillStyle = "#f0f0f3";
    rr(cx, y, w, 26, 13);
    ctx.fill();
    ctx.fillStyle = "#3a3a42";
    ctx.fillText(c, cx + 12, y + 18);
    cx += w + 8;
  }
  y += 40;

  const heading = (label: string) => {
    ctx.fillStyle = MUTED;
    ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(label.toUpperCase(), x0, y + 14);
    y += 34;
  };

  if (details.length) {
    heading("Delivery details");
    const colW = (CONTENT - 48) / 2;
    details.forEach(([label, value], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const dx = x0 + col * colW;
      const dy = y + row * 26;
      ctx.fillStyle = MUTED;
      ctx.font = "400 12px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(label, dx, dy + 8);
      ctx.fillStyle = INK;
      ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(value, dx, dy + 24);
    });
    y += Math.ceil(details.length / 2) * 26 + 4;
  }

  groups.forEach((g, gi) => {
    heading(g.title);
    g.items.forEach((it, i) => {
      const on = !!g.checks[it];
      const boxY = y + 3;
      rr(x0, boxY, 16, 16, 4);
      ctx.fillStyle = on ? INK : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = on ? INK : "#c9c9d0";
      ctx.stroke();
      if (on) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0 + 4, boxY + 8);
        ctx.lineTo(x0 + 7, boxY + 11.5);
        ctx.lineTo(x0 + 12, boxY + 4.5);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.fillStyle = on ? INK : "#4a4a52";
      ctx.font = body;
      groupLines[gi][i].forEach((ln, j) => {
        ctx.fillText(ln, x0 + 26, y + 16 + j * 24);
      });
      y += Math.max(26, groupLines[gi][i].length * 24);
    });
    y += 4;
  });

  if (noteLines.length) {
    heading("Comments");
    ctx.fillStyle = INK;
    ctx.font = body;
    noteLines.forEach((ln) => {
      ctx.fillText(ln, x0, y + 16);
      y += 24;
    });
    y += 4;
  }

  if (photos.length) {
    heading(`Photos (${photos.length})`);
    photos.forEach((img, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = x0 + col * (cellW + gap);
      const py = y + row * (cellH + gap);
      ctx.save();
      rr(px, py, cellW, cellH, 10);
      ctx.clip();
      const s = Math.max(cellW / img.width, cellH / img.height);
      const dw = img.width * s;
      const dh = img.height * s;
      ctx.drawImage(img, px + (cellW - dw) / 2, py + (cellH - dh) / 2, dw, dh);
      ctx.restore();
      ctx.strokeStyle = LINE;
      rr(px, py, cellW, cellH, 10);
      ctx.stroke();
    });
    y += photoRows * (cellH + gap) - gap + 4;
  }

  ctx.fillStyle = "#9a9aa2";
  ctx.font = "400 11px ui-sans-serif, system-ui, sans-serif";
  const foot = `Snapshot generated ${new Date().toLocaleString()}`;
  ctx.fillText(foot, (W - ctx.measureText(foot).width) / 2, H - PAD + 12);

  return await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
}

export async function downloadReceivingSnapshot(r: ReceivingSnapshotRecord) {
  const blob = await buildReceivingSnapshotPng(r);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receiving-report-${(r.date || "report").replace(/[^\w-]+/g, "-")}-${(
    r.time || ""
  ).replace(/[^\w-]+/g, "")}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
