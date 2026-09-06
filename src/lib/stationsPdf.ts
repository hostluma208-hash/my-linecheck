import { jsPDF } from "jspdf";
import {
  getEffectiveSections,
  effectiveCategorizedItems,
  loadSection,
  readEntry,
  getShifts,
  statusColor,
  todayISO,
} from "@/lib/lineCheck";

/** Builds and downloads a PDF report covering every station: all categories
 *  and items with the status and note recorded for each shift. */
export function downloadStationsPdf(date = todayISO()) {
  const shifts = getShifts();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = 0;

  const newPage = () => {
    doc.addPage();
    y = margin;
  };
  const ensure = (need: number) => {
    if (y + need > pageH - margin) newPage();
  };

  // Title page header
  y = margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Line Check — All Stations Report", margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(
    `Date: ${date}   •   Shifts: ${shifts.map((s) => s.label).join(", ")}`,
    margin,
    y,
  );
  y += 22;
  doc.setTextColor(0);

  const sections = getEffectiveSections();
  let totalItems = 0;
  let checkedItems = 0;
  let flagged = 0;

  sections.forEach((sec, si) => {
    const state = loadSection(sec.name, date);
    const cats = effectiveCategorizedItems(sec.name);
    if (si > 0) newPage();

    // Station header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(sec.name, margin, y);
    y += 14;
    doc.setDrawColor(200);
    doc.line(margin, y, pageW - margin, y);
    y += 12;

    for (const cat of cats) {
      ensure(24);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(60);
      doc.text(cat.group, margin, y);
      y += 12;

      // Column headers
      ensure(18);
      doc.setFontSize(9);
      doc.setTextColor(120);
      let x = margin;
      doc.text("Item", x, y);
      x = margin + 220;
      for (const s of shifts) {
        doc.text(s.label, x, y);
        x += 70;
      }
      doc.text("Note", x, y);
      y += 6;
      doc.setDrawColor(230);
      doc.line(margin, y, pageW - margin, y);
      y += 12;

      doc.setFont("helvetica", "normal");
      const seen = new Map<string, number>();
      for (const item of cat.items) {
        const occ = seen.get(item.name) ?? 0;
        seen.set(item.name, occ + 1);
        totalItems++;

        // Collect per-shift status/notes
        const cells: string[] = [];
        const notes: string[] = [];
        let anyChecked = false;
        for (const s of shifts) {
          const e = readEntry(state, cat.group, item.name, s.id, occ);
          const st = e?.status ?? "";
          cells.push(st || "—");
          if (st) {
            anyChecked = true;
            if (statusColor(st) === "red") flagged++;
          }
          if (e?.note) notes.push(`${s.label}: ${e.note}`);
        }
        if (anyChecked) checkedItems++;

        const itemLines = doc.splitTextToSize(item.name, 205) as string[];
        const noteLines = doc.splitTextToSize(notes.join("  |  ") || "—", 130) as string[];
        const rowH = Math.max(itemLines.length, noteLines.length) * 10 + 6;
        ensure(rowH);
        doc.setFontSize(9);
        doc.setTextColor(0);
        doc.text(itemLines, margin, y);
        x = margin + 220;
        doc.setFontSize(8.5);
        for (const c of cells) {
          doc.text(c, x, y);
          x += 70;
        }
        doc.setTextColor(110);
        doc.text(noteLines, x, y);
        doc.setTextColor(0);
        y += rowH;
      }
      y += 8;
    }
  });

  // Summary on the last page
  ensure(60);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Summary", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    `Stations: ${sections.length}   •   Items checked: ${checkedItems}/${totalItems}   •   Flagged: ${flagged}`,
    margin,
    y,
  );

  doc.save(`stations-report-${date}.pdf`);
}
