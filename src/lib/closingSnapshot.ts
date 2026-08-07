// Builds a self-contained HTML snapshot of a closing report so it can be
// downloaded, archived and opened later without the app.
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

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

export function buildClosingSnapshotHtml(r: ClosingSnapshotRecord): string {
  const brand = lsStore.getItem("linecheck:settings:brand:name") || "LUMA";
  const items = Object.keys(r.checks || {});
  const done = items.filter((i) => r.checks[i]).length;
  const crew = r.crew ?? [];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(brand)} — Closing Report ${esc(r.date)} ${esc(r.time)}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#f6f6f7;color:#111;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:800px;margin:0 auto;padding:28px 20px 56px}
h1{font-size:24px;margin:6px 0 2px;letter-spacing:-.01em}
.brand{font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:13px;color:#666}
.card{background:#fff;border:1px solid #e5e5e8;border-radius:16px;padding:18px;margin-top:16px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 4px}
.chip{background:#f1f1f4;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600}
h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#666;margin:18px 0 8px}
ul{margin:0;padding:0;list-style:none}
li{padding:2px 0}
.box{display:inline-grid;place-items:center;width:16px;height:16px;border:1px solid #c7c7cc;border-radius:4px;margin-right:8px;font-size:11px;vertical-align:-3px}
.box.on{background:#111;border-color:#111;color:#fff}
.notes{white-space:pre-wrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.grid img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;border:1px solid #e5e5e8}
.foot{margin-top:24px;font-size:11px;color:#888;text-align:center}
@media print{body{background:#fff}.card{border-color:#ddd}}
</style></head>
<body><div class="wrap">
<div class="brand">${esc(brand)}</div>
<h1>Closing Report</h1>
<div class="card">
<div class="chips">
<span class="chip">${esc(r.date || "—")}</span>
<span class="chip">${esc(r.time || "—")}</span>
${r.branch ? `<span class="chip">${esc(r.branch)}</span>` : ""}
${r.closedBy ? `<span class="chip">Closed by ${esc(r.closedBy)}</span>` : ""}
<span class="chip">${done}/${items.length} checked</span>
</div>
${
  crew.length
    ? `<h2>Closing team</h2><ul>${crew
        .map(
          (c) =>
            `<li><strong>${esc(c.member)}</strong>: ${esc(
              c.stations.length ? c.stations.join(", ") : "No station listed",
            )}</li>`,
        )
        .join("")}</ul>`
    : ""
}
<h2>Closing checklist</h2>
${
  items.length
    ? `<ul>${items
        .map(
          (it) =>
            `<li><span class="box${r.checks[it] ? " on" : ""}">${
              r.checks[it] ? "✓" : ""
            }</span>${esc(it)}</li>`,
        )
        .join("")}</ul>`
    : `<p>No items.</p>`
}
${r.notes ? `<h2>Notes</h2><div class="notes">${esc(r.notes)}</div>` : ""}
${
  r.photos.length
    ? `<h2>Photos (${r.photos.length})</h2><div class="grid">${r.photos
        .map((src, i) => `<img src="${esc(src)}" alt="Photo ${i + 1}">`)
        .join("")}</div>`
    : ""
}
</div>
<div class="foot">Snapshot generated ${esc(new Date().toLocaleString())}</div>
</div></body></html>`;
}

export function downloadClosingSnapshot(r: ClosingSnapshotRecord) {
  const html = buildClosingSnapshotHtml(r);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `closing-report-${(r.date || "report").replace(/[^\w-]+/g, "-")}-${(
    r.time || ""
  ).replace(/[^\w-]+/g, "")}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
