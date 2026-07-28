import { lsStore } from "@/lib/lsStore";

const STATIONS_KEY = "linecheck:order:stations";

function readArr(key: string): string[] {
  try {
    const raw = lsStore.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed;
  } catch {}
  return [];
}

function writeArr(key: string, arr: string[]) {
  try {
    lsStore.setItem(key, JSON.stringify(arr));
  } catch {}
}

export function getStationOrder(): string[] {
  return readArr(STATIONS_KEY);
}

export function setStationOrder(names: string[]) {
  writeArr(STATIONS_KEY, names);
}

/** Sort items by a saved order; unknown keys append in their original order. */
export function applyOrder<T>(items: T[], orderedKeys: string[], keyFn: (item: T) => string): T[] {
  if (orderedKeys.length === 0) return items;
  const rank = new Map(orderedKeys.map((k, i) => [k, i]));
  const known: T[] = [];
  const unknown: T[] = [];
  for (const it of items) {
    if (rank.has(keyFn(it))) known.push(it);
    else unknown.push(it);
  }
  known.sort((a, b) => (rank.get(keyFn(a))! - rank.get(keyFn(b))!));
  return [...known, ...unknown];
}
