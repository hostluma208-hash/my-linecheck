import data from "@/data/lineCheck.json";
import { lsStore, getUserScope } from "@/lib/lsStore";


export type Slot = string;
export type Entry = { status: string; note: string; photo?: string };
export type SectionState = {
  date: string;
  opening: string;
  mid: string;
  closing: string;
  entries: Record<string, Record<Slot, Entry>>;
};

export const STATUSES = data.statuses;

/** Returns the effective status list, merging user-defined statuses from
 *  settings with defaults. */
export function getEffectiveStatuses(): string[] {
  try {
    const raw = lsStore.getItem("linecheck:settings:statuses");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr.filter((s) => typeof s === "string");
    }
  } catch {}
  return STATUSES;
}
export const STAFF = data.staff;
export const SECTIONS = data.sections.filter((s) => s.items.length > 0);

export type SectionDef = { name: string; items: { name: string }[] };

/** Returns the effective list of stations, honoring user additions/renames
 *  stored under `linecheck:settings:stations`. Falls back to the shipped
 *  JSON structure when no override exists. */
export function getEffectiveSections(): SectionDef[] {
  try {
    const raw = lsStore.getItem("linecheck:settings:stations");
    if (raw) {
      const arr = JSON.parse(raw) as Array<{ name: string; items?: { name: string }[] }>;
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((s) => ({
          name: s.name,
          items: Array.isArray(s.items) ? s.items : [],
        }));
      }
    }
  } catch {}
  return SECTIONS;
}

/** Returns the effective items for a section, honoring user category edits
 *  stored under `linecheck:section-items:<name>`. Falls back to the station
 *  items configured in Settings, then the shipped JSON structure. */
export function effectiveItems(sectionName: string): { name: string }[] {
  return effectiveCategorizedItems(sectionName).flatMap((c) => c.items);
}

/** Returns the effective items grouped by category for a section. */
export function effectiveCategorizedItems(
  sectionName: string,
): { group: string; items: { name: string }[] }[] {
  try {
    const raw = lsStore.getItem(`linecheck:section-items:${sectionName}`);
    if (raw) {
      const cats = JSON.parse(raw) as { group?: string; items: { name: string }[] }[];
      if (Array.isArray(cats)) {
        return cats.map((c, i) => ({
          group: c.group ?? `Group ${i + 1}`,
          items: Array.isArray(c.items) ? c.items : [],
        }));
      }
    }
  } catch {}

  const sec = data.sections.find((s) => s.name === sectionName);
  if (sec) {
    const groups = new Map<string, { group: string; items: { name: string }[] }>();
    for (const item of sec.items) {
      const group = item.group || "Items";
      if (!groups.has(group)) groups.set(group, { group, items: [] });
      groups.get(group)?.items.push({ name: item.name });
    }
    return [...groups.values()];
  }

  const fromSettings = getEffectiveSections().find((s) => s.name === sectionName);
  if (fromSettings) return [{ group: "Items", items: fromSettings.items }];
  return [];
}

/** Compound entry key so items with the same display name in different
 *  categories don't share status. When multiple items in the same category
 *  share a name, `occurrence` disambiguates them (0 = first, 1 = second, …).
 *  Occurrence 0 keeps the historical key shape for backward compat. */
export function entryKey(group: string, itemName: string, occurrence = 0) {
  return occurrence > 0
    ? `${group}::${itemName}#${occurrence}`
    : `${group}::${itemName}`;
}

/** Reads an entry using the compound category+name(+occurrence) key. The
 *  legacy bare-name fallback was removed because it caused status mirroring
 *  across categories (and, for shared item names, across stations) whenever
 *  older data was still present in storage. */
export function readEntry(
  state: SectionState,
  group: string,
  itemName: string,
  slot: Slot,
  occurrence = 0,
): Entry | undefined {
  return state.entries[entryKey(group, itemName, occurrence)]?.[slot];
}


export const FLAG_STATUSES = new Set([
  "ABOUT TO EXPIRE",
  "EXPIRED",
  "NEED TO CLEAN",
  "WRONG LABEL",
]);
export const OK_STATUSES = new Set(["OK", "N/A", "F/O", "PREPPING"]);

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function storageKey(name: string, date = todayISO()) {
  return `linecheck:${name}:${date}`;
}

export function emptyEntry(): Entry {
  return { status: "", note: "" };
}

export function memberKey(date: string, slot: Slot) {
  return `linecheck:member:${slot}:${date}`;
}
export function loadMember(date: string, slot: Slot): string {
  try {
    return lsStore.getItem(memberKey(date, slot)) || "";
  } catch {
    return "";
  }
}
export function saveMember(date: string, slot: Slot, name: string) {
  try {
    if (name) lsStore.setItem(memberKey(date, slot), name);
    else lsStore.removeItem(memberKey(date, slot));
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("linecheck:update"));
  } catch {}
}

export type ShiftHistoryItem = {
  group: string;
  name: string;
  status: string;
  note: string;
  photo?: string;
  flagged: boolean;
};

export type ShiftHistoryStation = {
  name: string;
  totalItems: number;
  checkedItems: number;
  complete: boolean;
  flagged: number;
  items: ShiftHistoryItem[];
};

export type ShiftHistory = {
  date: string;
  slot: Slot;
  member: string;
  stationsTouched: number;
  stationsComplete: number;
  flagged: number;
  totalItems: number;
  checkedItems: number;
  stations: ShiftHistoryStation[];
};

export function shiftHistory(date: string, slot: Slot): ShiftHistory {
  let stationsTouched = 0;
  let stationsComplete = 0;
  let flagged = 0;
  let totalItems = 0;
  let checkedItems = 0;
  const stations: ShiftHistoryStation[] = [];
  for (const sec of getEffectiveSections()) {
    const state = loadSection(sec.name, date);
    const cats = effectiveCategorizedItems(sec.name);
    let anyTouched = false;
    let allDone = true;
    let secTotal = 0;
    let secChecked = 0;
    let secFlagged = 0;
    const stationItems: ShiftHistoryItem[] = [];
    for (const cat of cats) {
      const seen = new Map<string, number>();
      for (const item of cat.items) {
        const occ = seen.get(item.name) ?? 0;
        seen.set(item.name, occ + 1);
        totalItems++;
        secTotal++;
        const e = readEntry(state, cat.group, item.name, slot, occ);
        if (e?.status) {
          anyTouched = true;
          checkedItems++;
          secChecked++;
          if (FLAG_STATUSES.has(e.status)) {
            flagged++;
            secFlagged++;
          }
          stationItems.push({
            group: cat.group,
            name: item.name,
            status: e.status,
            note: e.note || "",
            photo: e.photo,
            flagged: FLAG_STATUSES.has(e.status),
          });
        } else {
          allDone = false;
        }
      }
    }
    if (anyTouched) {
      stationsTouched++;
      stations.push({
        name: sec.name,
        totalItems: secTotal,
        checkedItems: secChecked,
        complete: allDone && secTotal > 0,
        flagged: secFlagged,
        items: stationItems,
      });
    }
    if (anyTouched && allDone && secTotal > 0) stationsComplete++;
  }
  return {
    date,
    slot,
    member: loadMember(date, slot),
    stationsTouched,
    stationsComplete,
    flagged,
    totalItems,
    checkedItems,
    stations,
  };
}

export type ShiftDef = { id: string; label: string };

const DEFAULT_SHIFTS: ShiftDef[] = [
  { id: "op", label: "Opening" },
  { id: "mid", label: "Mid" },
  { id: "cl", label: "Closing" },
];
const DEFAULT_SLOT_LABELS: Record<string, string> = {
  op: "Opening",
  mid: "Mid",
  cl: "Closing",
};

export const SHIFT_LABELS_KEY = "linecheck:settings:shiftLabels";
export const SHIFTS_KEY = "linecheck:settings:shifts";

/** Returns the effective, ordered list of shifts. Reads the shift list first,
 *  falling back to the legacy label map, then defaults. */
export function getShifts(): ShiftDef[] {
  try {
    const raw = lsStore.getItem(SHIFTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as Array<{ id?: string; label?: string }>;
      if (Array.isArray(arr) && arr.length > 0) {
        const seen = new Set<string>();
        const out: ShiftDef[] = [];
        for (const s of arr) {
          const id = typeof s.id === "string" ? s.id.trim() : "";
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const label =
            typeof s.label === "string" && s.label.trim()
              ? s.label.trim()
              : DEFAULT_SLOT_LABELS[id] || id;
          out.push({ id, label });
        }
        if (out.length) return out;
      }
    }
  } catch {}
  // Legacy: derive from the label-only override.
  try {
    const raw = lsStore.getItem(SHIFT_LABELS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Record<string, string>>;
      return DEFAULT_SHIFTS.map((s) => ({
        id: s.id,
        label: (typeof p[s.id] === "string" && p[s.id]!.trim()) || s.label,
      }));
    }
  } catch {}
  return [...DEFAULT_SHIFTS];
}

export function saveShifts(shifts: ShiftDef[]) {
  try {
    lsStore.setItem(SHIFTS_KEY, JSON.stringify(shifts));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("linecheck:shifts-update"));
      window.dispatchEvent(new Event("linecheck:update"));
    }
  } catch {}
}

export function getShiftLabels(): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_SLOT_LABELS };
  for (const s of getShifts()) out[s.id] = s.label;
  return out;
}

export function getShiftLabel(slot: Slot): string {
  return getShiftLabels()[slot] ?? slot;
}

export const SLOT_LABEL = new Proxy({} as Record<string, string>, {
  get(_t, prop: string) {
    return getShiftLabels()[prop] ?? prop;
  },
  ownKeys() {
    return getShifts().map((s) => s.id);
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});



export function loadSection(name: string, date = todayISO()): SectionState {
  try {
    const raw = lsStore.getItem(storageKey(name, date));
    if (raw) return JSON.parse(raw);
  } catch {}
  return { date, opening: "", mid: "", closing: "", entries: {} };
}

export function defaultShift(): Slot {
  const shifts = getShifts();
  const ids = new Set(shifts.map((s) => s.id));
  const h = new Date().getHours();
  const pick = h < 11 ? "op" : h < 17 ? "mid" : "cl";
  if (ids.has(pick)) return pick;
  return shifts[0]?.id ?? "op";
}


export function sectionProgress(name: string, slot: Slot, date = todayISO()) {
  const state = loadSection(name, date);
  const cats = effectiveCategorizedItems(name);
  let done = 0;
  let flagged = 0;
  let total = 0;
  for (const cat of cats) {
    const seen = new Map<string, number>();
    for (const item of cat.items) {
      const occ = seen.get(item.name) ?? 0;
      seen.set(item.name, occ + 1);
      total++;
      const e = readEntry(state, cat.group, item.name, slot, occ);
      if (e?.status) done++;
      if (e?.status && FLAG_STATUSES.has(e.status)) flagged++;
    }
  }
  return { done, total, flagged };
}

export type FlaggedRow = {
  section: string;
  item: string;
  status: string;
  slot: Slot;
};

export function allFlagged(slot: Slot, date = todayISO()): FlaggedRow[] {
  const rows: FlaggedRow[] = [];
  for (const sec of getEffectiveSections()) {
    const state = loadSection(sec.name, date);
    for (const cat of effectiveCategorizedItems(sec.name)) {
      const seen = new Map<string, number>();
      for (const item of cat.items) {
        const occ = seen.get(item.name) ?? 0;
        seen.set(item.name, occ + 1);
        const e = readEntry(state, cat.group, item.name, slot, occ);
        if (e?.status && FLAG_STATUSES.has(e.status)) {
          rows.push({ section: sec.name, item: item.name, status: e.status, slot });
        }
      }
    }
  }
  return rows;
}

export type DayHistory = {
  date: string;
  stationsTouched: number;
  stationsComplete: number;
  flagged: number;
  totalItems: number;
  checkedItems: number;
};

export function listHistoryDates(): string[] {
  const dates = new Set<string>();
  // Touch scope so the function re-runs when scope changes elsewhere
  void getUserScope();
  try {
    for (const k of lsStore.keys()) {
      if (!k.startsWith("linecheck:")) continue;
      const parts = k.split(":");
      const d = parts[parts.length - 1];
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.add(d);
    }
  } catch {}
  return [...dates].sort((a, b) => (a < b ? 1 : -1));
}

/** Delete all recorded line-check data (per-shift member selections and
 *  per-section entries) for the current user scope. Settings (stations, staff,
 *  statuses, shelves, containers, branding) are preserved. */
export function clearAllHistory(): number {
  let removed = 0;
  try {
    for (const k of lsStore.keys()) {
      if (!k.startsWith("linecheck:")) continue;
      if (k.startsWith("linecheck:settings:")) continue;
      lsStore.removeItem(k);
      removed++;
    }
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("linecheck:update"));
  } catch {}
  return removed;
}

export function dayHistory(date: string): DayHistory {
  let stationsTouched = 0;
  let stationsComplete = 0;
  let flagged = 0;
  let totalItems = 0;
  let checkedItems = 0;
  for (const sec of getEffectiveSections()) {
    const state = loadSection(sec.name, date);
    const cats = effectiveCategorizedItems(sec.name);
    let anyTouched = false;
    let allDone = true;
    let secTotal = 0;
    for (const cat of cats) {
      const seen = new Map<string, number>();
      for (const item of cat.items) {
        const occ = seen.get(item.name) ?? 0;
        seen.set(item.name, occ + 1);
        totalItems++;
        secTotal++;
        const slots: Slot[] = getShifts().map((s) => s.id);
        let itemDoneAnyShift = false;
        for (const slot of slots) {
          const e = readEntry(state, cat.group, item.name, slot, occ);
          if (e?.status) {
            anyTouched = true;
            itemDoneAnyShift = true;
            if (FLAG_STATUSES.has(e.status)) flagged++;
          }
        }
        if (itemDoneAnyShift) checkedItems++;
        else allDone = false;
      }
    }
    if (anyTouched) stationsTouched++;
    if (anyTouched && allDone && secTotal > 0) stationsComplete++;
  }
  return { date, stationsTouched, stationsComplete, flagged, totalItems, checkedItems };
}
