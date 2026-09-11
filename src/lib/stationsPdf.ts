import { jsPDF } from "jspdf";
import { lsStore } from "@/lib/lsStore";
import {
  getEffectiveSections,
  effectiveCategorizedItems,
  loadSection,
  readEntry,
  getShifts,
  statusColor,
  todayISO,
} from "@/lib/lineCheck";

type PdfItem = {
  name: string;
  quality?: string | null;
  shelf?: string | null;
  container?: string | null;
};

type PdfCategory = {
  group: string;
  temp?: boolean;
  items: PdfItem[];
};

const CATEGORY_COLORS: Array<[number, number, number]> = [
  [49, 113, 191],
  [48, 143, 91],
  [199, 128, 25],
  [174, 72, 139],
  [36, 137, 151],
  [194, 79, 55],
  [112, 82, 166],
];

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = lsStore.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function stationCategories(name: string): PdfCategory[] {
  return effectiveCategorizedItems(name) as PdfCategory[];
}

/** Builds a station-board-style PDF report with saved categories, item details,
 * statuses, temperatures, corrective notes, and station comments. */
export function downloadStationsPdf(date = todayISO()) {
  const shifts = getShifts();
  const sections = getEffectiveSections();
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 34;
  const contentW = pageW - margin * 2;
  const statusW = Math.min(82, Math.max(58, 220 / Math.max(shifts.length, 1)));
  const detailsW = contentW - statusW * shifts.length;
  let y = margin;
  let pageNumber = 1;
  let currentStation = "";
  let currentProgress = "";
  let totalItems = 0;
  let checkedItems = 0;
  let flaggedItems = 0;

  const drawPageFooter = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130, 124, 116);
    doc.text(`Line Check • ${date}`, margin, pageH - 15);
    doc.text(`Page ${pageNumber}`, pageW - margin, pageH - 15, { align: "right" });
  };

  const drawStationHeader = (continued = false) => {
    doc.setFillColor(247, 243, 237);
    doc.roundedRect(margin, y, contentW, 48, 5, 5, "F");
    doc.setFillColor(169, 79, 48);
    doc.roundedRect(margin, y, 7, 48, 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(50, 45, 41);
    doc.text(`${currentStation}${continued ? " — continued" : ""}`, margin + 18, y + 21);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(105, 98, 91);
    doc.text(`${date}  •  ${currentProgress}`, margin + 18, y + 37);
    y += 60;
  };

  const newPage = (repeatStation = false) => {
    drawPageFooter();
    doc.addPage();
    pageNumber += 1;
    y = margin;
    if (repeatStation && currentStation) drawStationHeader(true);
  };

  const ensure = (need: number, repeatStation = true) => {
    if (y + need > pageH - 30) newPage(repeatStation);
  };

  const drawCategoryHeader = (
    category: PdfCategory,
    color: [number, number, number],
    temperatures: string[],
  ) => {
    ensure(42);
    doc.setFillColor(247, 247, 245);
    doc.roundedRect(margin, y, contentW, 30, 4, 4, "F");
    doc.setFillColor(...color);
    doc.roundedRect(margin, y, 5, 30, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...color);
    doc.text(category.group.toUpperCase(), margin + 14, y + 19);
    if (temperatures.some(Boolean)) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(105, 98, 91);
      doc.text(
        temperatures.map((value, index) => `${shifts[index]?.label ?? "Shift"}: ${value || "—"}`).join("   •   "),
        pageW - margin - 10,
        y + 19,
        { align: "right" },
      );
    }
    y += 37;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(120, 114, 108);
    doc.text("ITEM / DETAILS", margin + 11, y);
    shifts.forEach((shift, index) => {
      doc.text(shift.label.toUpperCase(), margin + detailsW + statusW * index + statusW / 2, y, {
        align: "center",
      });
    });
    y += 8;
    doc.setDrawColor(222, 218, 212);
    doc.line(margin, y, pageW - margin, y);
    y += 7;
  };

  sections.forEach((section, sectionIndex) => {
    const state = loadSection(section.name, date);
    const categories = stationCategories(section.name);
    const stationEntries = categories.flatMap((category) => {
      const seen = new Map<string, number>();
      return category.items.map((item) => {
        const occurrence = seen.get(item.name) ?? 0;
        seen.set(item.name, occurrence + 1);
        return shifts.map((shift) => readEntry(state, category.group, item.name, shift.id, occurrence));
      });
    });
    const stationTotal = stationEntries.length;
    const stationChecked = stationEntries.filter((entries) => entries.some((entry) => Boolean(entry?.status))).length;
    const stationFlagged = stationEntries.reduce(
      (count, entries) => count + entries.filter((entry) => entry?.status && statusColor(entry.status) === "red").length,
      0,
    );
    totalItems += stationTotal;
    checkedItems += stationChecked;
    flaggedItems += stationFlagged;
    currentStation = section.name;
    currentProgress = `${stationChecked}/${stationTotal} items checked  •  ${stationFlagged} flagged`;

    if (sectionIndex > 0) newPage(false);
    drawStationHeader();

    categories.forEach((category, categoryIndex) => {
      const color = CATEGORY_COLORS[categoryIndex % CATEGORY_COLORS.length] ?? CATEGORY_COLORS[0];
      const temperatures = shifts.map((shift) => {
        const values = readJson<Record<string, string>>(
          `linecheck:temps:${section.name}:${date}:${shift.id}`,
          {},
        );
        const value = values[category.group];
        return value ? `${value}°` : "";
      });
      drawCategoryHeader(category, color, temperatures);

      const seen = new Map<string, number>();
      category.items.forEach((item) => {
        const occurrence = seen.get(item.name) ?? 0;
        seen.set(item.name, occurrence + 1);
        const entries = shifts.map((shift) => readEntry(state, category.group, item.name, shift.id, occurrence));
        const detailParts = [item.shelf, item.container].filter(Boolean);
        const details = [detailParts.join(" • "), item.quality].filter(Boolean).join("  —  ");
        const itemLines = doc.splitTextToSize(item.name || "Unnamed item", detailsW - 24) as string[];
        const detailLines = details ? (doc.splitTextToSize(details, detailsW - 24) as string[]) : [];
        const notes = entries
          .map((entry, index) => (entry?.note?.trim() ? `${shifts[index]?.label ?? "Shift"}: ${entry.note.trim()}` : ""))
          .filter(Boolean);
        const noteLines = notes.length
          ? (doc.splitTextToSize(`Corrective note — ${notes.join("  |  ")}`, contentW - 28) as string[])
          : [];
        const rowH = Math.max(33, 13 + itemLines.length * 10 + detailLines.length * 9 + noteLines.length * 9);

        if (y + rowH > pageH - 30) {
          newPage(true);
          drawCategoryHeader(category, color, temperatures);
        }

        const anyFlagged = entries.some((entry) => entry?.status && statusColor(entry.status) === "red");
        doc.setFillColor(anyFlagged ? 255 : 255, anyFlagged ? 247 : 255, anyFlagged ? 245 : 255);
        doc.roundedRect(margin, y, contentW, rowH - 3, 3, 3, "F");
        doc.setDrawColor(anyFlagged ? 232 : 226, anyFlagged ? 178 : 222, anyFlagged ? 165 : 216);
        doc.roundedRect(margin, y, contentW, rowH - 3, 3, 3, "S");

        let textY = y + 14;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(48, 44, 40);
        doc.text(itemLines, margin + 10, textY);
        textY += itemLines.length * 10;
        if (detailLines.length) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.setTextColor(113, 106, 99);
          doc.text(detailLines, margin + 10, textY);
          textY += detailLines.length * 9;
        }
        if (noteLines.length) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(7.5);
          doc.setTextColor(164, 62, 48);
          doc.text(noteLines, margin + 10, textY);
        }

        entries.forEach((entry, index) => {
          const status = entry?.status || "Unchecked";
          const flagged = Boolean(entry?.status && statusColor(entry.status) === "red");
          const ok = Boolean(entry?.status && !flagged);
          if (flagged) doc.setFillColor(253, 226, 222);
          else if (ok) doc.setFillColor(222, 241, 226);
          else doc.setFillColor(241, 239, 235);
          const badgeX = margin + detailsW + statusW * index + 5;
          const badgeW = statusW - 10;
          doc.roundedRect(badgeX, y + 8, badgeW, 17, 4, 4, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(status.length > 13 ? 5.8 : 6.8);
          doc.setTextColor(flagged ? 155 : ok ? 38 : 116, flagged ? 52 : ok ? 112 : 110, flagged ? 44 : ok ? 65 : 104);
          doc.text(status.toUpperCase(), badgeX + badgeW / 2, y + 19, { align: "center", maxWidth: badgeW - 5 });
        });
        y += rowH + 4;
      });
      y += 8;
    });

    const comments = shifts
      .map((shift) => {
        const value = lsStore.getItem(`linecheck:section-comment:${section.name}:${date}:${shift.id}`)?.trim();
        return value ? `${shift.label}: ${value}` : "";
      })
      .filter(Boolean);
    if (comments.length) {
      const lines = doc.splitTextToSize(comments.join("  |  "), contentW - 24) as string[];
      ensure(34 + lines.length * 9);
      doc.setFillColor(247, 243, 237);
      doc.roundedRect(margin, y, contentW, 25 + lines.length * 9, 4, 4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(105, 98, 91);
      doc.text("STATION COMMENT / FEEDBACK", margin + 12, y + 14);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(48, 44, 40);
      doc.text(lines, margin + 12, y + 27);
      y += 33 + lines.length * 9;
    }
  });

  ensure(58, false);
  y += 8;
  doc.setFillColor(48, 45, 42);
  doc.roundedRect(margin, y, contentW, 45, 5, 5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("ALL STATIONS SUMMARY", margin + 14, y + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `${sections.length} stations  •  ${checkedItems}/${totalItems} items checked  •  ${flaggedItems} flagged statuses`,
    margin + 14,
    y + 34,
  );
  drawPageFooter();

  doc.save(`stations-report-${date}.pdf`);
}