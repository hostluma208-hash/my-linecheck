// Builds a self-contained PNG snapshot of a closing report so it can be
// downloaded, archived, shared in chat apps and viewed on any device.
import { lsStore } from "@/lib/lsStore";

type Crew = { member: string; stations: string[] };

export type ClosingSnapshotRecord = {
  id: string;
  date: string;
  time: string;
  branch?: string;
  closedBy?: string;
  crew?: Crew[];
  checks: Record<string, boolean>;
  notes?: string;
  photos: string[];
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

export async function buildClosingSnapshotPng(r: ClosingSnapshotRecord): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const brand = lsStore.getItem("linecheck:settings:brand:name") || "LUMA";
  const items = Object.keys(r.checks || {});
  const done = items.filter((i) => r.checks[i]).length;
  const crew = r.crew ?? [];

  const photos = (
    await Promise.all((r.photos || []).slice(0, 12).map((p) => loadImage(p)))
  ).filter(Boolean) as HTMLImageElement[];

  // measuring context
  const m = document.createElement("canvas").getContext("2d")!;
  const body = "400 15px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const bold = "600 15px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

  // --- layout pass -------------------------------------------------------
  const chips = [
    r.date || "—",
    r.time || "—",
    r.branch || "",
    r.closedBy ? `Closed by ${r.closedBy}` : "",
    `${done}/${items.length} checked`,
  ].filter(Boolean);

  const crewLines: string[][] = crew.map((c) => {
    m.font = body;
    return wrap(m, `${c.member} — ${c.stations.length ? c.stations.join(", ") : "No station listed"}`, CONTENT - 48);
  });

  m.font = body;
  const checkLines: string[][] = items.map((it) => wrap(m, it, CONTENT - 80));
  const noteLines = r.notes ? wrap(m, r.notes, CONTENT - 48) : [];

  const cols = 3;
  const gap = 12;
  const cellW = Math.floor((CONTENT - 48 - gap * (cols - 1)) / cols);
  const cellH = Math.round(cellW * 0.75);
  const photoRows = photos.length ? Math.ceil(photos.length / cols) : 0;

  let h = PAD; // top
  h += 22 + 40; // brand + title
  h += 24; // card top padding
  h += 40; // chips row
  if (crew.length) {
    h += 34;
    h += crewLines.reduce((a, l) => a + l.length * 24, 0) + 4;
  }
  h += 34;
  h += (checkLines.length ? checkLines.reduce((a, l) => a + Math.max(26, l.length * 24), 0) : 26) + 4;
  if (noteLines.length) {
    h += 34;
    h += noteLines.length * 24 + 4;
  }
  if (photoRows) {
    h += 34;
    h += photoRows * (cellH + gap) - gap + 4;
  }
  h += 28; // card bottom padding
  h += 46; // footer

  const H = Math.max(h, 420);

  // --- render ------------------------------------------------------------
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
  ctx.fillText("Closing Report", PAD, y + 18);
  y += 40;

  const cardTop = y;
  const cardH = H - PAD - 46 - cardTop + 24;
  ctx.fillStyle = CARD;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  const rr = (x: number, yy: number, w: number, hh: number, rad: number) => {
    ctx.beginPath();
    ctx.moveTo(x + rad, yy);
    ctx.arcTo(x + w, yy, x + w, yy + hh, rad);
    ctx.arcTo(x + w, yy + hh, x, yy + hh, rad);
    ctx.arcTo(x, yy + hh, x, yy, rad);
    ctx.arcTo(x, yy, x + w, yy, rad);
    ctx.closePath();
  };
  rr(PAD, cardTop, CONTENT, Math.max(cardH, 120), 18);
  ctx.fill();
  ctx.stroke();

  const x0 = PAD + 24;
  y = cardTop + 24;

  // chips
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

  if (crew.length) {
    heading("Closing team");
    crew.forEach((c, i) => {
      ctx.fillStyle = INK;
      crewLines[i].forEach((ln, j) => {
        ctx.font = j === 0 ? bold : body;
        ctx.fillText(ln, x0, y + 16);
        y += 24;
      });
    });
    y += 4;
  }

  heading("Closing checklist");
  if (!items.length) {
    ctx.fillStyle = MUTED;
    ctx.font = body;
    ctx.fillText("No items.", x0, y + 16);
    y += 26;
  } else {
    items.forEach((it, i) => {
      const on = !!r.checks[it];
      const boxY = y + 3;
      ctx.beginPath();
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
      checkLines[i].forEach((ln, j) => {
        ctx.fillText(ln, x0 + 26, y + 16 + j * 24);
      });
      y += Math.max(26, checkLines[i].length * 24);
    });
    y += 4;
  }

  if (noteLines.length) {
    heading("Notes");
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

export async function downloadClosingSnapshot(r: ClosingSnapshotRecord) {
  const blob = await buildClosingSnapshotPng(r);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `closing-report-${(r.date || "report").replace(/[^\w-]+/g, "-")}-${(
    r.time || ""
  ).replace(/[^\w-]+/g, "")}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
