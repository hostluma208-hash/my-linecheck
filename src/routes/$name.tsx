import { lsStore } from "@/lib/lsStore";
import { stationFromSlug } from "@/lib/slug";
import { compressImageFile } from "@/lib/image";

import { createFileRoute, useRouter } from "@tanstack/react-router";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, useShellState } from "@/components/AppShell";
import {
  SECTIONS,
  getEffectiveStatuses,
  emptyEntry,
  loadSection,
  storageKey,
  FLAG_STATUSES,
  OK_STATUSES,
  entryKey,
  readEntry,
  getShiftLabel,
  getEffectiveSections,
  effectiveCategorizedItems,
  type Entry,
  type SectionState,
  type Slot,
} from "@/lib/lineCheck";
import { Camera, Check, ChevronDown, FolderInput, ChevronUp, Download, Edit3, Filter, GripVertical, Image as ImageIcon, Save, Thermometer, Plus, Trash2, Upload, X } from "lucide-react";
import { z } from "zod";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type EditItem = { name: string; quality: string; shelf: string; container: string };
type EditCategory = { group: string; temp: boolean; items: EditItem[] };

const DEFAULT_SHELF_OPTIONS = ["By Expiration", "1 Day", "3 Days", "7 Days", "14 Days", "30 Days", "60 Days", "90 Days"];
const DEFAULT_CONTAINER_OPTIONS = ["Can", "Bottle", "1/3 Pan", "1/6 Pan", "1/9 Pan", "Full Pan", "Half Pan", "Quart", "Squeeze Bottle", "Other"];
const SHELVES_KEY = "linecheck:settings:shelves";
const CONTAINERS_KEY = "linecheck:settings:containers";

function readList(key: string, fallback: string[]): string[] {
  try {
    const raw = lsStore.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed;
    }
  } catch {}
  return fallback;
}

function useOptionList(key: string, evt: string, fallback: string[]): string[] {
  const [list, setList] = useState<string[]>(() => readList(key, fallback));
  useEffect(() => {
    const refresh = () => setList(readList(key, fallback));
    window.addEventListener(evt, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("linecheck:scope-change", refresh);
    return () => {
      window.removeEventListener(evt, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("linecheck:scope-change", refresh);
    };
  }, [key, evt, fallback]);
  return list;
}

function sectionStructKey(name: string) {
  return `linecheck:section-items:${name}`;
}

function loadSectionStruct(name: string, fallback: EditCategory[]): EditCategory[] {
  try {
    const raw = lsStore.getItem(sectionStructKey(name));
    if (raw) return JSON.parse(raw);
  } catch {}
  return fallback;
}

/** Load another station's category structure (saved edits, else defaults). */
function loadStationStruct(stationName: string): EditCategory[] {
  try {
    const raw = lsStore.getItem(sectionStructKey(stationName));
    if (raw) return JSON.parse(raw) as EditCategory[];
  } catch {}
  return effectiveCategorizedItems(stationName).map((c) => ({
    group: c.group,
    temp: /temp/i.test(c.group),
    items: c.items.map((i) => ({ name: i.name, quality: "", shelf: "", container: "" })),
  }));
}

export const Route = createFileRoute("/$name")({
  validateSearch: (s: Record<string, unknown>) =>
    z
      .object({
        date: z.string().optional(),
        shift: z.string().optional(),
      })
      .parse(s),
  head: ({ params }) => ({
    meta: [
      { title: `${params.name.replace(/-/g, " ")} — Line Check` },
      { name: "description", content: `Line check for ${params.name.replace(/-/g, " ")} section.` },
    ],
  }),
  component: SectionPage,
  notFoundComponent: () => <div className="p-10">Section not found.</div>,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-10">
        <p className="text-destructive">{error.message}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-4 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
        >
          Retry
        </button>
      </div>
    );
  },
});

const STATUS_STYLES: Record<string, string> = {
  OK: "bg-emerald-500 text-white border-emerald-500",
  "N/A": "bg-muted text-muted-foreground border-border",
  "F/O": "bg-amber-100 text-amber-900 border-amber-300",
  PREPPING: "bg-sky-100 text-sky-900 border-sky-300",
  "NEED TO CLEAN": "bg-sky-100 text-sky-900 border-sky-300",
  "WRONG LABEL": "bg-violet-100 text-violet-900 border-violet-300",
  "ABOUT TO EXPIRE": "bg-amber-100 text-amber-900 border-amber-300",
  EXPIRED: "bg-rose-100 text-rose-900 border-rose-300",
};

function buildDefaultStruct(section: { items: Array<{ name: string; group?: string | null; quality?: string | null; shelf?: string | null; container?: string | null }> }): EditCategory[] {
  const map = new Map<string, EditCategory>();
  for (const it of section.items) {
    const g = it.group || "Items";
    if (!map.has(g)) map.set(g, { group: g, temp: /temp/i.test(g), items: [] });
    map.get(g)!.items.push({
      name: it.name,
      quality: it.quality || "",
      shelf: it.shelf || "",
      container: it.container || "",
    });
  }
  return [...map.values()];
}

function SectionPage() {
  const { name: rawName } = Route.useParams();
  const name = useMemo(() => stationFromSlug(rawName), [rawName]);
  const search = Route.useSearch() as { date?: string; shift?: Slot };
  const section = useMemo(
    () => SECTIONS.find((s) => s.name === name) ?? { name, items: [] as { name: string }[] },
    [name],
  );
  const shell = useShellState(name);

  // Sync shell to search params when reopening a past shift from history.
  useEffect(() => {
    if (search.date && search.date !== shell.date) shell.setDate(search.date);
    if (search.shift && search.shift !== shell.shift) shell.setShift(search.shift);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.date, search.shift]);

  const key = useMemo(() => storageKey(name, shell.date), [name, shell.date]);
  const tempKey = useMemo(
    () => `linecheck:temps:${name}:${shell.date}:${shell.shift}`,
    [name, shell.date, shell.shift],
  );
  const commentKey = useMemo(
    () => `linecheck:section-comment:${name}:${shell.date}:${shell.shift}`,
    [name, shell.date, shell.shift],
  );
  const commentPhotosKey = useMemo(
    () => `linecheck:section-comment-photos:${name}:${shell.date}:${shell.shift}`,
    [name, shell.date, shell.shift],
  );
  const [state, setState] = useState<SectionState>(() => loadSection(name, shell.date));
  const [comment, setComment] = useState<string>("");
  const [commentPhotos, setCommentPhotos] = useState<string[]>([]);
  const [commentViewer, setCommentViewer] = useState<{ index: number; photo: string } | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [viewer, setViewer] = useState<{ group: string; name: string; occ: number; photo: string } | null>(null);
  const viewerFileRef = useRef<HTMLInputElement | null>(null);
  const viewerGalleryRef = useRef<HTMLInputElement | null>(null);
  const [temps, setTemps] = useState<Record<string, string>>({});
  const [tempUnit, setTempUnitState] = useState<"F" | "C">(() => {
    try {
      const v = lsStore.getItem("linecheck:settings:temp-unit");
      return v === "C" ? "C" : "F";
    } catch {
      return "F";
    }
  });
  const toggleTempUnit = () => {
    setTempUnitState((prev) => {
      const next = prev === "F" ? "C" : "F";
      try {
        lsStore.setItem("linecheck:settings:temp-unit", next);
      } catch {}
      return next;
    });
  };
  const SHELF_OPTIONS = useOptionList(SHELVES_KEY, "linecheck:shelves-update", DEFAULT_SHELF_OPTIONS);
  const CONTAINER_OPTIONS = useOptionList(CONTAINERS_KEY, "linecheck:containers-update", DEFAULT_CONTAINER_OPTIONS);

  // Temps are stored in Fahrenheit for backward compatibility.
  const displayTemp = (rawF: string | undefined) => {
    if (!rawF) return "";
    const n = parseFloat(rawF);
    if (!Number.isFinite(n)) return "";
    if (tempUnit === "F") return String(rawF);
    return String(Math.round(((n - 32) * 5) / 9 * 10) / 10);
  };
  const onTempInput = (group: string, value: string) => {
    if (value === "") {
      setTemp(group, "");
      return;
    }
    const n = parseFloat(value);
    if (!Number.isFinite(n)) {
      setTemp(group, value);
      return;
    }
    const asF = tempUnit === "F" ? value : String(Math.round(((n * 9) / 5 + 32) * 10) / 10);
    setTemp(group, asF);
  };

  useEffect(() => {
    try {
      const raw = lsStore.getItem(tempKey);
      setTemps(raw ? JSON.parse(raw) : {});
    } catch {
      setTemps({});
    }
  }, [tempKey]);

  useEffect(() => {
    try {
      setComment(lsStore.getItem(commentKey) ?? "");
    } catch {
      setComment("");
    }
  }, [commentKey]);

  useEffect(() => {
    try {
      const raw = lsStore.getItem(commentPhotosKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setCommentPhotos(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
    } catch {
      setCommentPhotos([]);
    }
  }, [commentPhotosKey]);

  const onCommentChange = (value: string) => {
    setComment(value);
    try {
      if (value) lsStore.setItem(commentKey, value);
      else lsStore.removeItem(commentKey);
      window.dispatchEvent(new Event("linecheck:update"));
    } catch {}
  };

  const persistCommentPhotos = (next: string[]) => {
    setCommentPhotos(next);
    try {
      if (next.length) lsStore.setItem(commentPhotosKey, JSON.stringify(next));
      else lsStore.removeItem(commentPhotosKey);
      window.dispatchEvent(new Event("linecheck:update"));
    } catch {}
  };

  const addCommentPhoto = async (file: File) => {
    const MAX = 15 * 1024 * 1024;
    if (file.size > MAX) {
      alert("Image too large (max 15MB).");
      return;
    }
    const dataUrl = await compressImageFile(file);
    if (dataUrl) {
      setCommentPhotos((prev) => {
        const next = [...prev, dataUrl];
        try {
          lsStore.setItem(commentPhotosKey, JSON.stringify(next));
          window.dispatchEvent(new Event("linecheck:update"));
        } catch {}
        return next;
      });
    }
  };



  const setTemp = (group: string, value: string) => {
    setTemps((prev) => {
      const next = { ...prev, [group]: value };
      try {
        lsStore.setItem(tempKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const defaultStruct = useMemo(
    () => (section ? buildDefaultStruct(section) : []),
    [section],
  );
  const [struct, setStruct] = useState<EditCategory[]>(() =>
    loadSectionStruct(name, defaultStruct),
  );
  const [draft, setDraft] = useState<EditCategory[]>(struct);
  const viewSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const persistStruct = (next: EditCategory[]) => {
    try {
      lsStore.setItem(sectionStructKey(name), JSON.stringify(next));
    } catch {}
    setStruct(next);
    setDraft(next);
    window.dispatchEvent(new Event("linecheck:update"));
  };

  // Quick action: move an item from one category to another (view mode),
  // carrying its saved statuses/notes/photos along with it.
  const quickMoveItem = (fromGroup: string, itemIdx: number, toGroup: string) => {
    if (fromGroup === toGroup) return;
    const fromCat = struct.find((c) => c.group === fromGroup);
    const toCat = struct.find((c) => c.group === toGroup);
    const moved = fromCat?.items[itemIdx];
    if (!fromCat || !toCat || !moved) return;
    const fromOcc = fromCat.items.slice(0, itemIdx).filter((i) => i.name === moved.name).length;
    const toOcc = toCat.items.filter((i) => i.name === moved.name).length;

    setState((prev) => {
      const entries = { ...prev.entries };
      const oldKey = entryKey(fromGroup, moved.name, fromOcc);
      const newKey = entryKey(toGroup, moved.name, toOcc);
      if (entries[oldKey]) {
        entries[newKey] = entries[oldKey];
        delete entries[oldKey];
      }
      // Re-key later duplicates in the source category (their occurrence shifts down).
      let shift = fromOcc;
      fromCat.items.forEach((it, j) => {
        if (j <= itemIdx || it.name !== moved.name) return;
        const cur = entryKey(fromGroup, it.name, shift + 1);
        const next = entryKey(fromGroup, it.name, shift);
        if (entries[cur]) {
          entries[next] = entries[cur];
          delete entries[cur];
        }
        shift += 1;
      });
      return { ...prev, entries };
    });

    persistStruct(
      struct.map((c) => {
        if (c.group === fromGroup) return { ...c, items: c.items.filter((_, j) => j !== itemIdx) };
        if (c.group === toGroup) return { ...c, items: [...c.items, moved] };
        return c;
      }),
    );
  };

  // Quick action: move an item to a category in ANOTHER station, carrying its
  // saved status/note/photo for the current date along with it.
  const quickMoveItemToStation = (
    fromGroup: string,
    itemIdx: number,
    toStation: string,
    toGroup: string,
  ) => {
    const fromCat = struct.find((c) => c.group === fromGroup);
    const moved = fromCat?.items[itemIdx];
    if (!fromCat || !moved) return;
    const fromOcc = fromCat.items.slice(0, itemIdx).filter((i) => i.name === moved.name).length;

    // Target station structure
    const targetStruct = loadStationStruct(toStation);
    const targetCat = targetStruct.find((c) => c.group === toGroup);
    if (!targetCat) return;
    const toOcc = targetCat.items.filter((i) => i.name === moved.name).length;

    const entry = readEntry(state, fromGroup, moved.name, slot, fromOcc);

    // Write item into the target station's structure
    const nextTarget = targetStruct.map((c) =>
      c.group === toGroup ? { ...c, items: [...c.items, moved] } : c,
    );
    try {
      lsStore.setItem(sectionStructKey(toStation), JSON.stringify(nextTarget));
    } catch {}

    // Carry the entry over to the target station's saved state
    if (entry?.status || entry?.note || entry?.photo) {
      try {
        const tState = loadSection(toStation, shell.date);
        tState.entries[entryKey(toGroup, moved.name, toOcc)] = {
          ...tState.entries[entryKey(toGroup, moved.name, toOcc)],
          [slot]: entry,
        } as Record<Slot, Entry>;
        lsStore.setItem(storageKey(toStation, shell.date), JSON.stringify(tState));
      } catch {}
    }

    // Remove from this station (and re-key later duplicates)
    setState((prev) => {
      const entries = { ...prev.entries };
      delete entries[entryKey(fromGroup, moved.name, fromOcc)];
      let shift = fromOcc;
      fromCat.items.forEach((it, j) => {
        if (j <= itemIdx || it.name !== moved.name) return;
        const cur = entryKey(fromGroup, it.name, shift + 1);
        const nxt = entryKey(fromGroup, it.name, shift);
        if (entries[cur]) {
          entries[nxt] = entries[cur];
          delete entries[cur];
        }
        shift += 1;
      });
      return { ...prev, entries };
    });

    persistStruct(
      struct.map((c) =>
        c.group === fromGroup ? { ...c, items: c.items.filter((_, j) => j !== itemIdx) } : c,
      ),
    );
  };

  const otherStations = useMemo(
    () =>
      getEffectiveSections()
        .filter((s) => s.name !== name)
        .map((s) => ({ name: s.name, groups: loadStationStruct(s.name).map((c) => c.group) }))
        .filter((s) => s.groups.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, struct],
  );


  useEffect(() => {
    setState(loadSection(name, shell.date));
  }, [name, shell.date]);

  useEffect(() => {
    const s = loadSectionStruct(name, defaultStruct);
    setStruct(s);
    setDraft(s);
  }, [name, defaultStruct]);

  useEffect(() => {
    try {
      lsStore.setItem(key, JSON.stringify(state));
      window.dispatchEvent(new Event("linecheck:update"));
    } catch {}
  }, [key, state]);

  if (!section) return <div className="p-10">Section not found.</div>;

  const slot: Slot = shell.shift;
  const STATUSES = getEffectiveStatuses();
  const allItems = struct.flatMap((c) => c.items);
  // Assign each item a per-category occurrence index so duplicates within a
  // category (or the same name appearing twice) get independent entries.
  const allCatItems = struct.flatMap((c) => {
    const seen = new Map<string, number>();
    return c.items.map((i) => {
      const occ = seen.get(i.name) ?? 0;
      seen.set(i.name, occ + 1);
      return { group: c.group, name: i.name, occ };
    });
  });
  const total = allItems.length;
  const done = allCatItems.filter(
    (ci) => readEntry(state, ci.group, ci.name, slot, ci.occ)?.status,
  ).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const missingNotes = allCatItems.filter((ci) => {
    const e = readEntry(state, ci.group, ci.name, slot, ci.occ);
    return e?.status && FLAG_STATUSES.has(e.status) && !e.note?.trim();
  });
  const canSave = missingNotes.length === 0;

  const setEntry = (group: string, item: string, occ: number, patch: Partial<Entry>) => {
    const k = entryKey(group, item, occ);
    setState((prev) => ({
      ...prev,
      entries: {
        ...prev.entries,
        [k]: {
          op: prev.entries[k]?.op ?? emptyEntry(),
          mid: prev.entries[k]?.mid ?? emptyEntry(),
          cl: prev.entries[k]?.cl ?? emptyEntry(),
          [slot]: { ...(prev.entries[k]?.[slot] ?? emptyEntry()), ...patch },
        },
      },
    }));
  };


  const toggleCheck = (group: string, item: string, occ: number) => {
    const cur = readEntry(state, group, item, slot, occ)?.status;
    setEntry(group, item, occ, { status: cur === "OK" ? "" : "OK" });
  };

  /** Apply a status to every item in the station, using the freshest stored
   *  snapshot so a racing sync pull can't clobber the bulk change. */
  const bulkSet = (status: string) => {
    const fresh = loadSection(name, shell.date);
    const entries: SectionState["entries"] = { ...fresh.entries };
    for (const ci of allCatItems) {
      const k = entryKey(ci.group, ci.name, ci.occ);
      const prev = entries[k] ?? {};
      entries[k] = {
        ...prev,
        [slot]: { ...(prev[slot] ?? emptyEntry()), status },
      } as SectionState["entries"][string];
    }
    const next: SectionState = { ...fresh, entries };
    setState(next);
    try {
      lsStore.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event("linecheck:update"));
    } catch {}
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  };

  const markAllOK = () => bulkSet("OK");

  // Reset guard: a station may only be unmarked once per shift + manager combo.
  // Picking a new shift or a new team member unlocks it again.
  const resetCtxKey = `linecheck:reset-ctx:${name}:${shell.date}`;
  const resetCtx = `${slot}|${shell.member}`;
  const lastResetCtx = (() => {
    try {
      return lsStore.getItem(resetCtxKey) || "";
    } catch {
      return "";
    }
  })();
  const canReset = lastResetCtx !== resetCtx;

  const unmarkAll = () => {
    if (!canReset) return;
    bulkSet("");
    try {
      lsStore.setItem(resetCtxKey, resetCtx);
    } catch {}
  };



  const saveCheck = () => {
    if (!canSave) return;
    try {
      lsStore.setItem(key, JSON.stringify(state));
      window.dispatchEvent(new Event("linecheck:update"));
    } catch {}
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  };


  const enterEdit = () => {
    setDraft(JSON.parse(JSON.stringify(struct)));
    setEditMode(true);
  };
  const cancelEdit = () => {
    setDraft(struct);
    setEditMode(false);
  };
  const saveCategories = () => {
    try {
      lsStore.setItem(sectionStructKey(name), JSON.stringify(draft));
    } catch {}
    setStruct(draft);
    setEditMode(false);
  };

  const updateCat = (i: number, patch: Partial<EditCategory>) =>
    setDraft((d) => d.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeCat = (i: number) =>
    setDraft((d) => d.filter((_, idx) => idx !== i));
  const addCat = () =>
    setDraft((d) => [...d, { group: "New Category", temp: false, items: [] }]);
  const updateItem = (ci: number, ii: number, patch: Partial<EditItem>) =>
    setDraft((d) =>
      d.map((c, idx) =>
        idx === ci ? { ...c, items: c.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) } : c,
      ),
    );
  const removeItem = (ci: number, ii: number) =>
    setDraft((d) =>
      d.map((c, idx) => (idx === ci ? { ...c, items: c.items.filter((_, j) => j !== ii) } : c)),
    );
  const addItem = (ci: number) =>
    setDraft((d) =>
      d.map((c, idx) =>
        idx === ci
          ? { ...c, items: [...c.items, { name: "", quality: "", shelf: "By Expiration", container: "Can" }] }
          : c,
      ),
    );
  const moveItemToCategory = (ci: number, ii: number, toCi: number) =>
    setDraft((d) => {
      if (toCi === ci || toCi < 0 || toCi >= d.length) return d;
      const item = d[ci]?.items[ii];
      if (!item) return d;
      return d.map((c, idx) => {
        if (idx === ci) return { ...c, items: c.items.filter((_, j) => j !== ii) };
        if (idx === toCi) return { ...c, items: [...c.items, item] };
        return c;
      });
    });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const downloadTemplate = () => {
    const header = "Category,Temp,Item,Quality,Shelf,Container";
    const esc = (v: string) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows: string[] = [header];
    const source = draft.length ? draft : struct;
    if (source.length === 0) {
      rows.push("Items,false,Sample Item,Fresh,By Expiration,1/6 Pan");
    } else {
      for (const cat of source) {
        if (cat.items.length === 0) {
          rows.push([cat.group, cat.temp ? "true" : "false", "", "", "", ""].map(esc).join(","));
        }
        for (const it of cat.items) {
          rows.push(
            [cat.group, cat.temp ? "true" : "false", it.name, it.quality, it.shelf, it.container]
              .map(esc)
              .join(","),
          );
        }
      }
    }
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^\w-]+/g, "_")}-template.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const parseCsv = (text: string): string[][] => {
    const rows: string[][] = [];
    let cur: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { cur.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
          if (field !== "" || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ""; }
          if (c === "\r" && text[i + 1] === "\n") i++;
        } else field += c;
      }
    }
    if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
    return rows;
  };

  const uploadTemplate = async (file: File) => {
    try {
      const text = await file.text();
      const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
      if (rows.length < 2) { alert("CSV is empty."); return; }
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const idx = (k: string) => header.indexOf(k);
      const iCat = idx("category"), iTemp = idx("temp"), iItem = idx("item"),
        iQual = idx("quality"), iShelf = idx("shelf"), iCont = idx("container");
      if (iCat < 0 || iItem < 0) {
        alert("CSV must have at least 'Category' and 'Item' columns.");
        return;
      }
      const map = new Map<string, EditCategory>();
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const group = (row[iCat] ?? "").trim();
        if (!group) continue;
        const tempVal = iTemp >= 0 ? (row[iTemp] ?? "").trim().toLowerCase() : "";
        const temp = tempVal === "true" || tempVal === "1" || tempVal === "yes";
        if (!map.has(group)) map.set(group, { group, temp, items: [] });
        const cat = map.get(group)!;
        if (temp) cat.temp = true;
        const itemName = (row[iItem] ?? "").trim();
        if (!itemName) continue;
        cat.items.push({
          name: itemName,
          quality: iQual >= 0 ? (row[iQual] ?? "").trim() : "",
          shelf: iShelf >= 0 ? (row[iShelf] ?? "").trim() : "",
          container: iCont >= 0 ? (row[iCont] ?? "").trim() : "",
        });
      }
      const next = [...map.values()];
      if (next.length === 0) { alert("No valid rows found in CSV."); return; }
      const replace = window.confirm(
        `Import ${next.reduce((a, c) => a + c.items.length, 0)} items into ${next.length} categor${next.length === 1 ? "y" : "ies"}?\n\nOK = Replace current categories\nCancel = Merge with existing`,
      );
      if (replace) {
        setDraft(next);
      } else {
        setDraft((d) => {
          const merged: EditCategory[] = d.map((c) => ({ ...c, items: [...c.items] }));
          for (const inc of next) {
            const existing = merged.find((c) => c.group.toLowerCase() === inc.group.toLowerCase());
            if (existing) {
              if (inc.temp) existing.temp = true;
              existing.items.push(...inc.items);
            } else merged.push(inc);
          }
          return merged;
        });
      }
    } catch (e) {
      alert("Failed to parse CSV: " + (e instanceof Error ? e.message : String(e)));
    }
  };


  const moveCat = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const moveItem = (ci: number, ii: number, dir: -1 | 1) =>
    setDraft((d) =>
      d.map((c, idx) => {
        if (idx !== ci) return c;
        const j = ii + dir;
        if (j < 0 || j >= c.items.length) return c;
        const items = [...c.items];
        [items[ii], items[j]] = [items[j], items[ii]];
        return { ...c, items };
      }),
    );

  const shiftLabel = getShiftLabel(slot);
  const ringStyle = {
    background: `conic-gradient(var(--ring-color, hsl(258 90% 66%)) ${pct * 3.6}deg, hsl(var(--muted)) 0deg)`,
  } as React.CSSProperties;

  if (!shell.member) {
    return (
      <AppShell {...shell}>
        <div className="mx-auto max-w-md rounded-2xl border border-danger/40 bg-danger-soft p-6 text-center">
          <h1 className="text-lg font-bold text-danger">Select a team member first</h1>
          <p className="mt-2 text-sm text-danger/90">
            You must pick your name from the Team Member picker in the top bar
            before opening a station.
          </p>
          <button
            onClick={() => { window.location.href = "/"; }}
            className="mt-4 inline-flex items-center rounded-full border border-danger/40 bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent"
          >
            Back to Overview
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell {...shell}>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-base font-bold tracking-tight">{section.name}</h1>
      </div>

      {/* Hero card */}
      <section className="rounded-2xl border border-border bg-card px-4 py-4 shadow-sm sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-extrabold tracking-tight">{section.name}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {done} of {total} items checked{!editMode && ` · ${shiftLabel}`}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
            <div
              className="grid h-14 w-14 shrink-0 place-items-center rounded-full"
              style={ringStyle}
              aria-label={`${pct} percent complete`}
            >
              <div className="grid h-[46px] w-[46px] place-items-center rounded-full bg-card text-sm font-bold tabular-nums">
                {editMode ? done : pct}
              </div>
            </div>
            {!editMode && (
              <>
                <button
                  onClick={() => setFlaggedOnly((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition ${
                    flaggedOnly
                      ? "border-rose-300 bg-rose-50 text-rose-700"
                      : "border-border bg-card hover:bg-accent"
                  }`}
                >
                  <Filter className="h-3.5 w-3.5" /> {flaggedOnly ? "Flagged Only" : "All Items"}
                </button>
                <button
                  onClick={markAllOK}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold hover:bg-accent"
                >
                  <Check className="h-3.5 w-3.5" /> Mark All OK
                </button>
                <button
                  onClick={unmarkAll}
                  disabled={!canReset}
                  title={
                    canReset
                      ? undefined
                      : "Already reset for this shift — select a new shift or team member first"
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" /> Unmark All
                </button>

                <button
                  onClick={enterEdit}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold hover:bg-accent"
                >
                  <Edit3 className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={saveCheck}
                  disabled={!canSave}
                  title={!canSave ? `Add notes for ${missingNotes.length} flagged item(s)` : undefined}
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-2 text-xs font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" /> {savedFlash ? "Saved!" : "Save Check"}
                </button>


              </>
            )}
            {editMode && (
              <>
                <button
                  onClick={saveCategories}
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background hover:opacity-90"
                >
                  <Save className="h-3.5 w-3.5" /> Save Categories
                </button>
                <button
                  onClick={cancelEdit}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
              </>
            )}
          </div>
        </div>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: "var(--gradient-readiness)" }}
          />
        </div>
      </section>

      {/* Edit Categories & Items panel */}
      {editMode && (
        <section className="mt-5 rounded-2xl border border-border bg-card px-6 py-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Edit Categories &amp; Items
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={downloadTemplate}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                title="Download a CSV template pre-filled with current items"
              >
                <Download className="h-3.5 w-3.5" /> Download Template
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                title="Upload a CSV to bulk-add items"
              >
                <Upload className="h-3.5 w-3.5" /> Upload CSV
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadTemplate(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={addCat}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" /> Add Category
              </button>
            </div>
          </div>

          <EditDraftDnd
            draft={draft}
            setDraft={setDraft}
            updateCat={updateCat}
            removeCat={removeCat}
            updateItem={updateItem}
            removeItem={removeItem}
            addItem={addItem}
            moveItemToCategory={moveItemToCategory}
            SHELF_OPTIONS={SHELF_OPTIONS}
            CONTAINER_OPTIONS={CONTAINER_OPTIONS}
          />
        </section>
      )}


      {/* Groups (view mode) */}
      {!editMode &&
        struct
          .map((cat) => {
            const seen = new Map<string, number>();
            const withOcc = cat.items.map((item, idx) => {
              const occ = seen.get(item.name) ?? 0;
              seen.set(item.name, occ + 1);
              return { item, occ, idx };
            });
            const visible = withOcc.filter(({ item, occ }) => {
              if (!flaggedOnly) return true;
              const s = readEntry(state, cat.group, item.name, slot, occ)?.status;
              return !!s && FLAG_STATUSES.has(s);
            });
            return [cat, visible] as const;
          })
          .filter(([, visible]) => visible.length > 0)
          .map(([cat, items], catIdx) => {
            const palette = [
              "oklch(0.65 0.18 250)",
              "oklch(0.65 0.18 145)",
              "oklch(0.70 0.18 55)",
              "oklch(0.65 0.20 330)",
              "oklch(0.65 0.15 195)",
              "oklch(0.65 0.20 25)",
              "oklch(0.65 0.18 285)",
            ];
            const accent = palette[catIdx % palette.length];
            const bg = `color-mix(in oklch, ${accent} 10%, var(--card))`;
            const headingColor = `color-mix(in oklch, ${accent} 65%, var(--foreground))`;
            return (
            <section
              key={cat.group}
              className="mt-6 rounded-2xl border border-border p-3 category-block"
              style={{
                background: bg,
                borderLeft: `4px solid ${accent}`,
              }}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                <h3 className="text-sm font-bold uppercase tracking-[0.14em]" style={{ color: headingColor }}>
                  {cat.group}
                </h3>
                {cat.temp && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <Thermometer className="h-3 w-3 text-sky-500" />
                    <label className="uppercase tracking-wide">Temp</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={displayTemp(temps[cat.group])}
                      onChange={(ev) => onTempInput(cat.group, ev.target.value)}
                      placeholder="—"
                      aria-label={`${cat.group} temperature reading`}
                      className="w-14 rounded-md border border-input bg-background px-1.5 py-0.5 text-[11px] font-semibold text-foreground outline-none focus:border-foreground/40"
                    />
                    <button
                      type="button"
                      onClick={toggleTempUnit}
                      aria-label={`Switch temperature unit (currently ${tempUnit === "F" ? "Fahrenheit" : "Celsius"})`}
                      className="rounded px-1 py-0.5 text-[11px] font-semibold text-foreground hover:bg-accent"
                    >
                      °{tempUnit}
                    </button>
                  </div>
                )}
              </div>

              <DndContext
                sensors={viewSensors}
                collisionDetection={closestCenter}
                onDragEnd={(ev: DragEndEvent) => {
                  const { active, over } = ev;
                  if (!over || active.id === over.id) return;
                  const from = items.find((v) => `${v.item.name}#${v.occ}` === active.id)?.idx;
                  const to = items.find((v) => `${v.item.name}#${v.occ}` === over.id)?.idx;
                  if (from == null || to == null) return;
                  persistStruct(
                    struct.map((c) =>
                      c.group === cat.group ? { ...c, items: arrayMove(c.items, from, to) } : c,
                    ),
                  );
                }}
              >
                <SortableContext
                  items={items.map(({ item, occ }) => `${item.name}#${occ}`)}
                  strategy={verticalListSortingStrategy}
                >
              <div className="space-y-2">
                {items.map(({ item, occ, idx }) => {
                  const e = readEntry(state, cat.group, item.name, slot, occ);
                  const status = e?.status ?? "";
                  const checked = !!status && OK_STATUSES.has(status);
                  const flagged = status && FLAG_STATUSES.has(status);
                  const itemPct = status ? 100 : 0;

                  const noteMissing = flagged && !e?.note?.trim();
                  return (
                    <SortableCheckRow
                      key={`${item.name}#${occ}`}
                      id={`${item.name}#${occ}`}
                      className={`rounded-2xl border bg-card transition ${
                        noteMissing ? "border-rose-400 ring-1 ring-rose-200" : flagged ? "border-rose-200" : "border-border"
                      }`}
                    >
                      {(handle) => (<>
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:flex-nowrap sm:gap-3">
                      {handle}

                      <button
                        onClick={() => toggleCheck(cat.group, item.name, occ)}
                        aria-label={checked ? "Uncheck item" : "Mark item OK"}
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition ${
                          checked
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-input bg-background hover:bg-accent"
                        }`}
                      >
                        {checked && <Check className="h-4 w-4" strokeWidth={3} />}
                      </button>

                      <div className="min-w-0 flex-1 basis-[45%]">
                        <p
                          className={`truncate text-sm font-semibold ${
                            checked ? "text-muted-foreground line-through" : "text-foreground"
                          }`}
                        >
                          {item.name}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {[item.shelf, item.container].filter(Boolean).join(" · ") || "—"}
                        </p>
                        {item.quality && (
                          <p className="truncate text-[11px] italic text-muted-foreground/80">
                            {item.quality}
                          </p>
                        )}
                      </div>

                      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
                      <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-muted sm:block">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${itemPct}%`,
                            background: `linear-gradient(90deg, hsl(${50 - itemPct * 0.22} 95% 55%), hsl(${45 - itemPct * 0.22} 95% 50%))`,
                          }}
                        />
                      </div>

                      <div className="relative shrink-0">
                        <select
                          value={status}
                          onChange={(ev) => setEntry(cat.group, item.name, occ, { status: ev.target.value })}
                          className={`appearance-none rounded-md border px-2.5 py-1 pr-6 text-[11px] font-semibold uppercase tracking-wide ${
                            status
                              ? STATUS_STYLES[status] ?? "border-border bg-card"
                              : "border-input bg-background text-muted-foreground"
                          }`}
                          aria-label={`${item.name} status`}
                        >
                          <option value="">Unchecked</option>
                          {STATUSES.map((s: string) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <svg
                          className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 opacity-70"
                          viewBox="0 0 12 12"
                          fill="none"
                        >
                          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>

                      <label
                        className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-accent"
                        aria-label={`Choose photo from gallery for ${item.name}`}
                        title="Choose from gallery"
                      >
                        <ImageIcon className="h-4 w-4" />
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (ev) => {
                            const file = ev.target.files?.[0];
                            ev.target.value = "";
                            if (!file) return;
                            const MAX = 15 * 1024 * 1024;
                            if (file.size > MAX) {
                              alert("Image too large (max 15MB).");
                              return;
                            }
                            const dataUrl = await compressImageFile(file);
                            if (dataUrl) setEntry(cat.group, item.name, occ, { photo: dataUrl });
                          }}
                        />
                      </label>

                      {e?.photo && (
                        <button
                          type="button"
                          onClick={() => setViewer({ group: cat.group, name: item.name, occ, photo: e.photo! })}
                          className="grid h-7 w-7 place-items-center overflow-hidden rounded-md border border-border"
                          title="View photo"
                          aria-label={`View photo for ${item.name}`}
                        >
                          <img src={e.photo} alt="" className="h-full w-full object-cover" />
                        </button>
                      )}

                      {(struct.length > 1 || otherStations.length > 0) && (
                        <div className="relative shrink-0">
                          <select
                            value=""
                            onChange={(ev) => {
                              const raw = ev.target.value;
                              ev.target.value = "";
                              if (!raw) return;
                              const [st, grp] = raw.split("\u241F");
                              if (st === name) quickMoveItem(cat.group, idx, grp);
                              else quickMoveItemToStation(cat.group, idx, st, grp);
                            }}
                            title="Move to another category or station"
                            aria-label={`Move ${item.name} to another category or station`}
                            className="h-7 w-7 cursor-pointer appearance-none rounded-full border border-transparent bg-transparent text-transparent hover:bg-accent"
                          >
                            <option value="" className="bg-popover text-popover-foreground">Move to…</option>
                            <optgroup label={name} className="bg-popover text-popover-foreground">
                              {struct
                                .filter((c) => c.group !== cat.group)
                                .map((c) => (
                                  <option key={c.group} value={`${name}\u241F${c.group}`} className="bg-popover text-popover-foreground">
                                    {c.group}
                                  </option>
                                ))}
                            </optgroup>
                            {otherStations.map((st) => (
                              <optgroup key={st.name} label={st.name} className="bg-popover text-popover-foreground">
                                {st.groups.map((g) => (
                                  <option key={g} value={`${st.name}\u241F${g}`} className="bg-popover text-popover-foreground">
                                    {g}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          <FolderInput className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />
                        </div>
                      )}

                      </div>

                      </div>
                      {flagged && (
                        <div className="border-t border-border/60 px-3 py-2.5">
                          <div className="mb-1.5 flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                              Corrective Note
                            </label>
                            {noteMissing && (
                              <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                                Required
                              </span>
                            )}
                          </div>
                          <textarea
                            value={e?.note ?? ""}
                            onChange={(ev) => setEntry(cat.group, item.name, occ, { note: ev.target.value })}
                            placeholder={`Describe the issue (${status})…`}
                            rows={2}
                            className={`w-full resize-y rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-foreground/40 ${
                              noteMissing ? "border-rose-300" : "border-input"
                            }`}
                          />
                        </div>
                      )}
                      </>)}
                    </SortableCheckRow>
                  );
                })}

              </div>
                </SortableContext>
              </DndContext>
            </section>

          );})}

      {!editMode && (
        <section className="mt-8">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Station Comment / Feedback
            </h3>
            <div className="flex items-center gap-2">
              <label
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Take a photo with the camera"
                aria-label="Capture reference image for station comment"
              >
                <Camera className="h-3.5 w-3.5" />
                <span>Camera</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(ev) => {
                    const file = ev.target.files?.[0];
                    ev.target.value = "";
                    if (file) addCommentPhoto(file);
                  }}
                />
              </label>
              <label
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Choose images from gallery"
                aria-label="Choose reference images from gallery"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                <span>Gallery</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(ev) => {
                    const files = Array.from(ev.target.files ?? []);
                    ev.target.value = "";
                    files.forEach((f) => addCommentPhoto(f));
                  }}
                />
              </label>

              <span className="text-[10px] text-muted-foreground">
                Auto-saved · {slot.toUpperCase()}
              </span>
            </div>
          </div>
          <div className="rounded-md border border-input bg-background focus-within:border-foreground/40">
            <AutoGrowTextarea
              value={comment}
              onChange={onCommentChange}
              placeholder={`Add a comment or feedback for ${name}…`}
              className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none focus:outline-none focus:ring-0"
            />
            {commentPhotos.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-border/60 px-3 py-2">
                {commentPhotos.map((photo, idx) => (
                  <div key={idx} className="relative">
                    <button
                      type="button"
                      onClick={() => setCommentViewer({ index: idx, photo })}
                      className="grid h-16 w-16 place-items-center overflow-hidden rounded-md border border-border"
                      title="View reference photo"
                      aria-label={`View reference photo ${idx + 1}`}
                    >
                      <img src={photo} alt="" className="h-full w-full object-cover" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Remove this reference photo?")) {
                          persistCommentPhotos(commentPhotos.filter((_, i) => i !== idx));
                        }
                      }}
                      className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow hover:text-foreground"
                      aria-label={`Remove reference photo ${idx + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </section>
      )}
      {commentViewer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setCommentViewer(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Station reference photo"
        >
          <div
            className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{name} — Reference</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  Photo {commentViewer.index + 1} of {commentPhotos.length}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCommentViewer(null)}
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close photo viewer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-black/40 p-2">
              <img src={commentViewer.photo} alt="" className="mx-auto max-h-[70vh] w-auto object-contain" />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  if (!commentViewer) return;
                  if (confirm("Remove this reference photo?")) {
                    const next = commentPhotos.filter((_, i) => i !== commentViewer.index);
                    persistCommentPhotos(next);
                    setCommentViewer(null);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {viewer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewer(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Photo for ${viewer.name}`}
        >
          <div
            className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{viewer.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{viewer.group}</div>
              </div>
              <button
                type="button"
                onClick={() => setViewer(null)}
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close photo viewer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-black/40 p-2">
              <img src={viewer.photo} alt={viewer.name} className="mx-auto max-h-[70vh] w-auto object-contain" />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
              <input
                ref={viewerFileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (ev) => {
                  const file = ev.target.files?.[0];
                  ev.target.value = "";
                  if (!file || !viewer) return;
                  const MAX = 15 * 1024 * 1024;
                  if (file.size > MAX) {
                    alert("Image too large (max 15MB).");
                    return;
                  }
                  const dataUrl = await compressImageFile(file);
                  if (dataUrl) {
                    setEntry(viewer.group, viewer.name, viewer.occ, { photo: dataUrl });
                    setViewer({ ...viewer, photo: dataUrl });
                  }
                }}

              />
              <input
                ref={viewerGalleryRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (ev) => {
                  const file = ev.target.files?.[0];
                  ev.target.value = "";
                  if (!file || !viewer) return;
                  const MAX = 15 * 1024 * 1024;
                  if (file.size > MAX) {
                    alert("Image too large (max 15MB).");
                    return;
                  }
                  const dataUrl = await compressImageFile(file);
                  if (dataUrl) {
                    setEntry(viewer.group, viewer.name, viewer.occ, { photo: dataUrl });
                    setViewer({ ...viewer, photo: dataUrl });
                  }
                }}
              />
              <button
                type="button"
                onClick={() => viewerFileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <Camera className="h-3.5 w-3.5" />
                Retake
              </button>
              <button
                type="button"
                onClick={() => viewerGalleryRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                Gallery
              </button>

              <button
                type="button"
                onClick={() => {
                  if (confirm("Remove this photo?")) {
                    setEntry(viewer.group, viewer.name, viewer.occ, { photo: undefined });
                    setViewer(null);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// ---------- Auto-growing textarea ----------

function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(ev) => onChange(ev.target.value)}
      placeholder={placeholder}
      rows={3}
      className={
        className ??
        "w-full resize-none overflow-hidden rounded-2xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-foreground/40"
      }
    />
  );
}


// ---------- Drag-and-drop edit UI ----------


type EditDraftDndProps = {
  draft: EditCategory[];
  setDraft: React.Dispatch<React.SetStateAction<EditCategory[]>>;
  updateCat: (i: number, patch: Partial<EditCategory>) => void;
  removeCat: (i: number) => void;
  updateItem: (ci: number, ii: number, patch: Partial<EditItem>) => void;
  removeItem: (ci: number, ii: number) => void;
  addItem: (ci: number) => void;
  moveItemToCategory: (ci: number, ii: number, toCi: number) => void;
  SHELF_OPTIONS: string[];
  CONTAINER_OPTIONS: string[];
};

function EditDraftDnd(props: EditDraftDndProps) {
  const { draft, setDraft } = props;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const catIds = draft.map((_, i) => `cat-${i}`);

  const handleCatDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Item reorder (within the same category)
    if (activeId.startsWith("item-") && overId.startsWith("item-")) {
      const [, aCi, aIi] = activeId.split("-").map(Number);
      const [, oCi, oIi] = overId.split("-").map(Number);
      if (aCi !== oCi) return;
      setDraft((d) =>
        d.map((c, idx) => (idx === aCi ? { ...c, items: arrayMove(c.items, aIi, oIi) } : c)),
      );
      return;
    }

    if (!activeId.startsWith("cat-") || !overId.startsWith("cat-")) return;
    const from = catIds.indexOf(activeId);
    const to = catIds.indexOf(overId);
    if (from < 0 || to < 0) return;
    setDraft((d) => arrayMove(d, from, to));
  };


  return (
    <div className="space-y-5">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatDragEnd}>
        <SortableContext items={catIds} strategy={verticalListSortingStrategy}>
          {draft.map((cat, ci) => (
            <SortableCategory key={ci} ci={ci} cat={cat} {...props} />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableCategory({
  ci,
  cat,
  draft,
  setDraft,
  updateCat,
  removeCat,
  updateItem,
  removeItem,
  addItem,
  moveItemToCategory,
  SHELF_OPTIONS,
  CONTAINER_OPTIONS,
}: EditDraftDndProps & { ci: number; cat: EditCategory }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `cat-${ci}`,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const itemIds = cat.items.map((_, i) => `item-${ci}-${i}`);


  return (
    <div ref={setNodeRef} style={style} className="rounded-xl border border-border bg-background/40 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Reorder category"
          className="grid h-7 w-6 shrink-0 cursor-grab place-items-center rounded text-muted-foreground hover:bg-accent active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <input
          value={cat.group}
          onChange={(e) => updateCat(ci, { group: e.target.value })}
          placeholder="Category name"
          className="flex-1 rounded-lg border border-input bg-card px-3 py-2 text-sm font-bold tracking-tight outline-none focus:border-foreground/30"
        />
        <label
          className={`grid h-7 w-7 cursor-pointer place-items-center rounded-md border ${
            cat.temp
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-input bg-background text-muted-foreground"
          }`}
        >
          <input
            type="checkbox"
            checked={cat.temp}
            onChange={(e) => updateCat(ci, { temp: e.target.checked })}
            className="sr-only"
          />
          {cat.temp && <Check className="h-4 w-4" strokeWidth={3} />}
        </label>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Thermometer className="h-3.5 w-3.5 text-sky-500" /> Temp
        </span>
        <button
          onClick={() => removeCat(ci)}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
          aria-label="Delete category"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-2">
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {cat.items.map((it, ii) => (
            <SortableItem
              key={ii}
              ci={ci}
              ii={ii}
              it={it}
              updateItem={updateItem}
              removeItem={removeItem}
              moveItemToCategory={moveItemToCategory}
              categories={draft.map((c) => c.group)}
              SHELF_OPTIONS={SHELF_OPTIONS}
              CONTAINER_OPTIONS={CONTAINER_OPTIONS}
            />
          ))}
        </SortableContext>

        <button
          onClick={() => addItem(ci)}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-card/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Add Item
        </button>
      </div>
    </div>
  );
}

function SortableItem({
  ci,
  ii,
  it,
  updateItem,
  removeItem,
  moveItemToCategory,
  categories,
  SHELF_OPTIONS,
  CONTAINER_OPTIONS,
}: {
  ci: number;
  ii: number;
  it: EditItem;
  updateItem: (ci: number, ii: number, patch: Partial<EditItem>) => void;
  removeItem: (ci: number, ii: number) => void;
  moveItemToCategory: (ci: number, ii: number, toCi: number) => void;
  categories: string[];
  SHELF_OPTIONS: string[];
  CONTAINER_OPTIONS: string[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `item-${ci}-${ii}`,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="space-y-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Reorder item"
          className="grid h-7 w-6 shrink-0 cursor-grab place-items-center rounded text-muted-foreground hover:bg-accent active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <input
          value={it.name}
          onChange={(e) => updateItem(ci, ii, { name: e.target.value })}
          placeholder="Item name"
          className="flex-1 rounded-lg border border-input bg-card px-3 py-1.5 text-sm outline-none focus:border-foreground/30"
        />
        <select
          value=""
          onChange={(e) => {
            const toCi = Number(e.target.value);
            if (!Number.isNaN(toCi)) moveItemToCategory(ci, ii, toCi);
            e.currentTarget.selectedIndex = 0;
          }}
          title="Move to category"
          aria-label="Move to category"
          className="max-w-[140px] rounded-lg border border-input bg-card px-2 py-1.5 text-xs outline-none focus:border-foreground/30"
        >
          <option value="">Move to…</option>
          {categories.map((g, idx) =>
            idx === ci ? null : (
              <option key={idx} value={idx}>
                {g || `Category ${idx + 1}`}
              </option>
            ),
          )}
        </select>
        <button
          onClick={() => removeItem(ci, ii)}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
          aria-label="Delete item"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={it.quality}
          onChange={(e) => updateItem(ci, ii, { quality: e.target.value })}
          placeholder="Quality / spec"
          className="min-w-[200px] flex-1 rounded-lg border border-input bg-card px-3 py-1.5 text-xs outline-none focus:border-foreground/30"
        />
        <select
          value={it.shelf}
          onChange={(e) => updateItem(ci, ii, { shelf: e.target.value })}
          className="rounded-lg border border-input bg-card px-3 py-1.5 text-xs outline-none"
        >
          {[it.shelf, ...SHELF_OPTIONS.filter((o) => o !== it.shelf)]
            .filter(Boolean)
            .map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
        </select>
        <select
          value={it.container}
          onChange={(e) => updateItem(ci, ii, { container: e.target.value })}
          className="rounded-lg border border-input bg-card px-3 py-1.5 text-xs outline-none"
        >
          {[it.container, ...CONTAINER_OPTIONS.filter((o) => o !== it.container)]
            .filter(Boolean)
            .map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
        </select>
        <div className="w-7" />
      </div>
    </div>
  );
}

function SortableCheckRow({
  id,
  className,
  children,
}: {
  id: string;
  className: string;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder item"
      title="Drag to reorder"
      className="grid h-7 w-5 shrink-0 cursor-grab touch-none place-items-center rounded text-muted-foreground hover:bg-accent active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 20 : undefined,
        position: "relative",
      }}
      className={className}
    >
      {children(handle)}
    </div>
  );
}
