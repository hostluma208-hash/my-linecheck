import { lsStore } from "@/lib/lsStore";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, useShellState, SECTION_ICONS } from "@/components/AppShell";
import { SECTIONS, STAFF, STATUSES, getShifts, saveShifts, type Slot, type ShiftDef } from "@/lib/lineCheck";
import { supabase } from "@/integrations/supabase/client";
import { ADMIN_EMAIL, isAdminEmail } from "@/lib/allowlist";
import {
  ArrowLeft,
  Settings as SettingsIcon,
  Utensils,
  Users,
  Tag,
  Clock,
  Package,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Check,
  Image as ImageIcon,
  Upload,
  Pencil,
  ShieldCheck,
} from "lucide-react";


export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Line Check 2026" },
      { name: "description", content: "Manage stations, items, team members and status options." },
    ],
  }),
  component: SettingsPage,
});

type Tab = "branding" | "stations" | "team" | "statuses" | "shifts" | "shelves" | "containers" | "access" | "admins";

const ICON_OPTIONS = Object.keys(SECTION_ICONS);

type LocalStation = {
  name: string;
  icon: string;
  items: { name: string }[];
};

const STATIONS_KEY = "linecheck:settings:stations";
const STAFF_KEY = "linecheck:settings:staff";
const STATUSES_KEY = "linecheck:settings:statuses";
const SHELVES_KEY = "linecheck:settings:shelves";
const CONTAINERS_KEY = "linecheck:settings:containers";

const DEFAULT_SHELVES = [
  "By Expiration",
  "1 Day",
  "2 Days",
  "3 Days",
  "5 Days",
  "7 Days",
  "30 Days",
  "60 Days",
];
const DEFAULT_CONTAINERS = [
  "Can",
  "Bottle",
  "Jar",
  "Container",
  "1/9 Pan",
  "1/6 Pan",
  "1/4 Pan",
  "1/3 Pan",
  "1/2 Pan",
  "Full Pan",
  "Squeeze Bottle",
  "Drizzle Bottle",
  "Shaker",
  "Piping Bag",
];

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = lsStore.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {}
  return fallback;
}

function SettingsPage() {
  const shell = useShellState("Settings");
  const [tab, setTab] = useState<Tab>("branding");
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentEmail(data.user?.email ?? null));
  }, []);
  const isAdmin = isAdminEmail(currentEmail);

  return (
    <AppShell {...shell} title="Settings">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center gap-3">
          <Link
            to="/"
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-foreground hover:bg-muted"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <SettingsIcon className="h-5 w-5 text-foreground" />
          <h2 className="text-2xl font-extrabold tracking-tight">Settings</h2>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <TabPill active={tab === "branding"} onClick={() => setTab("branding")} icon={<ImageIcon className="h-4 w-4" />}>
            Branding
          </TabPill>
          <TabPill active={tab === "stations"} onClick={() => setTab("stations")} icon={<Utensils className="h-4 w-4" />}>
            Stations & Items
          </TabPill>
          <TabPill active={tab === "team"} onClick={() => setTab("team")} icon={<Users className="h-4 w-4" />}>
            Team Members
          </TabPill>
          <TabPill active={tab === "statuses"} onClick={() => setTab("statuses")} icon={<Tag className="h-4 w-4" />}>
            Status Options
          </TabPill>
          <TabPill active={tab === "shifts"} onClick={() => setTab("shifts")} icon={<Clock className="h-4 w-4" />}>
            Shifts
          </TabPill>
          <TabPill active={tab === "shelves"} onClick={() => setTab("shelves")} icon={<Clock className="h-4 w-4" />}>
            Shelf Life
          </TabPill>
          <TabPill active={tab === "containers"} onClick={() => setTab("containers")} icon={<Package className="h-4 w-4" />}>
            Container
          </TabPill>
          {isAdmin && (
            <TabPill active={tab === "access"} onClick={() => setTab("access")} icon={<ShieldCheck className="h-4 w-4" />}>
              Access
            </TabPill>
          )}
          {isAdmin && (
            <TabPill active={tab === "admins"} onClick={() => setTab("admins")} icon={<ShieldCheck className="h-4 w-4" />}>
              Admins
            </TabPill>
          )}
        </div>

        {tab === "branding" && <BrandingPanel />}
        {tab === "stations" && <StationsPanel />}
        {tab === "team" && <TeamPanel />}
        {tab === "statuses" && <StatusPanel />}
        {tab === "shifts" && <ShiftsPanel />}
        {tab === "shelves" && (
          <SimpleListPanel
            storageKey={SHELVES_KEY}
            defaults={DEFAULT_SHELVES}
            icon={<Clock className="h-4 w-4 text-muted-foreground" />}
            placeholder="New shelf life (e.g. 3 Days)..."
            eventName="linecheck:shelves-update"
          />
        )}
        {tab === "containers" && (
          <SimpleListPanel
            storageKey={CONTAINERS_KEY}
            defaults={DEFAULT_CONTAINERS}
            icon={<Package className="h-4 w-4 text-muted-foreground" />}
            placeholder="New container (e.g. 1/6 Pan)..."
            eventName="linecheck:containers-update"
          />
        )}
        {tab === "access" && isAdmin && <AccessPanel />}
        {tab === "admins" && isAdmin && <AdminsPanel />}
      </div>
    </AppShell>
  );
}

/* ============= BRANDING ============= */

const BRAND_NAME_KEY = "linecheck:settings:brand:name";
const BRAND_LOGO_KEY = "linecheck:settings:brand:logo";

function BrandingPanel() {
  const [name, setName] = useState("LUMA");
  const [logo, setLogo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setName(lsStore.getItem(BRAND_NAME_KEY) || "LUMA");
      setLogo(lsStore.getItem(BRAND_LOGO_KEY));
    } catch {}
  }, []);

  const saveName = (v: string) => {
    setName(v);
    try {
      lsStore.setItem(BRAND_NAME_KEY, v);
      window.dispatchEvent(new Event("linecheck:brand-update"));
    } catch {}
  };

  const onFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Please choose an image under 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setLogo(dataUrl);
      try {
        lsStore.setItem(BRAND_LOGO_KEY, dataUrl);
        window.dispatchEvent(new Event("linecheck:brand-update"));
      } catch {
        alert("Image too large to store locally.");
      }
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setLogo(null);
    try {
      lsStore.removeItem(BRAND_LOGO_KEY);
      window.dispatchEvent(new Event("linecheck:brand-update"));
    } catch {}
  };

  const initial = (name || "L").trim().charAt(0).toUpperCase() || "L";

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="flex flex-col items-center gap-3">
          {logo ? (
            <img src={logo} alt={name} className="h-24 w-24 rounded-2xl object-cover border border-border" />
          ) : (
            <span className="grid h-24 w-24 place-items-center rounded-2xl bg-foreground text-background text-3xl font-bold">
              {initial}
            </span>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90"
            >
              <Upload className="h-3.5 w-3.5" /> Upload
            </button>
            {logo && (
              <button
                onClick={removeLogo}
                className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-danger hover:bg-danger-soft"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </div>

        <div className="flex-1">
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Brand name
          </label>
          <input
            value={name}
            onChange={(e) => saveName(e.target.value)}
            placeholder="LUMA"
            className="mt-2 w-full rounded-full border border-border bg-background px-5 py-3 text-sm outline-none focus:border-foreground/30"
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Your branding and all settings are stored on this device only —
            each account stays independent and your customizations are kept
            across app updates.
          </p>
        </div>
      </div>
    </div>
  );
}

function TabPill({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? "bg-foreground text-background shadow-sm"
          : "border border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/* ============= STATIONS ============= */

function renameStationKeys(oldName: string, newName: string) {
  if (oldName === newName) return;
  const oldEntry = `linecheck:${oldName}:`;
  const oldStruct = `linecheck:section-items:${oldName}`;
  const oldTemps = `linecheck:temps:${oldName}:`;
  const oldOrderCats = `linecheck:order:section:${oldName}:categories`;
  const oldOrderItemsPrefix = `linecheck:order:section:${oldName}:items:`;
  try {
    for (const k of lsStore.keys()) {
      let target: string | null = null;
      if (k.startsWith(oldEntry)) target = `linecheck:${newName}:` + k.slice(oldEntry.length);
      else if (k === oldStruct) target = `linecheck:section-items:${newName}`;
      else if (k.startsWith(oldTemps)) target = `linecheck:temps:${newName}:` + k.slice(oldTemps.length);
      else if (k === oldOrderCats) target = `linecheck:order:section:${newName}:categories`;
      else if (k.startsWith(oldOrderItemsPrefix))
        target = `linecheck:order:section:${newName}:items:` + k.slice(oldOrderItemsPrefix.length);
      if (target) {
        const v = lsStore.getItem(k);
        if (v != null) lsStore.setItem(target, v);
        lsStore.removeItem(k);
      }
    }
    // Update station order list
    const orderRaw = lsStore.getItem("linecheck:order:stations");
    if (orderRaw) {
      try {
        const arr = JSON.parse(orderRaw) as string[];
        if (Array.isArray(arr)) {
          const next = arr.map((n) => (n === oldName ? newName : n));
          lsStore.setItem("linecheck:order:stations", JSON.stringify(next));
        }
      } catch {}
    }
  } catch {}
}

function StationsPanel() {
  const initial: LocalStation[] = useMemo(
    () =>
      SECTIONS.map((s) => ({
        name: s.name,
        icon: Object.keys(SECTION_ICONS).find((k) => k === s.name) ?? "Utensils",
        items: s.items.map((i) => ({ name: i.name })),
      })),
    [],
  );
  const [stations, setStations] = useState<LocalStation[]>(() =>
    loadJSON(STATIONS_KEY, initial),
  );
  const [name, setName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    lsStore.setItem(STATIONS_KEY, JSON.stringify(stations));
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("linecheck:update"));
  }, [stations]);

  const add = () => {
    const n = name.trim().toUpperCase();
    if (!n) {
      setAddError("Please enter a station name.");
      return;
    }
    if (stations.some((s) => s.name.toUpperCase() === n)) {
      setAddError(`A station named "${n}" already exists.`);
      return;
    }
    const used = new Set(stations.map((s) => s.icon));
    const nextIcon =
      ICON_OPTIONS.find((k) => !used.has(k)) ??
      ICON_OPTIONS[stations.length % ICON_OPTIONS.length] ??
      "Utensils";
    setStations((s) => [{ name: n, icon: nextIcon, items: [] }, ...s]);
    setName("");
    setAddError(null);
  };

  const startRename = (idx: number) => {
    setRenamingIdx(idx);
    setRenameValue(stations[idx].name);
    setRenameError(null);
  };
  const cancelRename = () => {
    setRenamingIdx(null);
    setRenameValue("");
    setRenameError(null);
  };
  const commitRename = (idx: number) => {
    const oldName = stations[idx].name;
    const newName = renameValue.trim().toUpperCase();
    if (!newName) {
      setRenameError("Station name cannot be empty.");
      return;
    }
    if (newName === oldName) {
      cancelRename();
      return;
    }
    if (stations.some((s, i) => i !== idx && s.name.toUpperCase() === newName)) {
      setRenameError(`A station named "${newName}" already exists.`);
      return;
    }
    renameStationKeys(oldName, newName);
    setStations((s) => s.map((x, i) => (i === idx ? { ...x, name: newName } : x)));
    if (expanded === oldName) setExpanded(newName);
    cancelRename();
  };

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (addError) setAddError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="New station name..."
            aria-invalid={!!addError}
            className={`flex-1 rounded-full border bg-card px-5 py-3 text-sm outline-none focus:border-foreground/30 ${addError ? "border-danger" : "border-border"}`}
          />
          <button
            onClick={add}
            className="flex items-center gap-1.5 rounded-full bg-muted-foreground/80 px-5 py-3 text-sm font-semibold text-background hover:bg-foreground"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
        {addError && (
          <p role="alert" className="mt-2 px-2 text-sm font-medium text-danger">
            {addError}
          </p>
        )}
      </div>

      <ul className="space-y-2">
        {stations.map((st, idx) => {
          const Icon = SECTION_ICONS[st.icon] ?? Utensils;
          const open = expanded === st.name;
          const isRenaming = renamingIdx === idx;
          return (
            <li
              key={st.name + idx}
              className="rounded-2xl border border-border bg-card shadow-sm"
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => setExpanded(open ? null : st.name)}
                  className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                  aria-label="Expand"
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                <IconPicker
                  value={st.icon}
                  onChange={(v) =>
                    setStations((s) =>
                      s.map((x, i) => (i === idx ? { ...x, icon: v } : x)),
                    )
                  }
                />

                <Icon className="h-4 w-4 text-muted-foreground" />
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => {
                      setRenameValue(e.target.value);
                      if (renameError) setRenameError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(idx);
                      if (e.key === "Escape") cancelRename();
                    }}
                    onBlur={() => commitRename(idx)}
                    aria-invalid={!!renameError}
                    className={`min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm font-bold tracking-tight outline-none focus:border-foreground/40 ${renameError ? "border-danger" : "border-border"}`}
                  />
                ) : (
                  <>
                    <span className="font-bold tracking-tight">{st.name}</span>
                    <button
                      onClick={() => startRename(idx)}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Rename"
                      title="Rename station"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}


                <span className="ml-auto text-xs text-muted-foreground">
                  {st.items.length} cats
                </span>
                <button
                  onClick={() => {
                    if (confirm(`Delete station "${st.name}"? This does not delete its saved check history.`))
                      setStations((s) => s.filter((_, i) => i !== idx));
                  }}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {isRenaming && renameError && (
                <p role="alert" className="border-t border-border px-4 py-2 text-sm font-medium text-danger">
                  {renameError}
                </p>
              )}
              {open && (
                <div className="border-t border-border px-12 py-3">
                  {st.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No categories yet. Open this station from the dashboard and use{" "}
                      <span className="font-semibold">Edit Categories</span> to add items.
                    </p>
                  ) : (
                    <ul className="grid grid-cols-2 gap-1.5 text-xs">
                      {st.items.map((it) => (
                        <li
                          key={it.name}
                          className="rounded-md bg-muted/50 px-2 py-1 text-muted-foreground"
                        >
                          {it.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ============= ICON PICKER ============= */

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const Current = SECTION_ICONS[value] ?? Utensils;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Choose icon"
        className="grid h-8 w-8 place-items-center rounded-md border border-border bg-background text-warning hover:bg-muted"
      >
        <Current className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-30 w-56 rounded-xl border border-border bg-card p-2 shadow-lg">
          <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Pick an icon
          </p>
          <div className="grid grid-cols-6 gap-1">
            {ICON_OPTIONS.map((k) => {
              const Ico = SECTION_ICONS[k] ?? Utensils;
              const active = k === value;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    onChange(k);
                    setOpen(false);
                  }}
                  title={k}
                  className={`relative grid h-8 w-8 place-items-center rounded-md border transition ${
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Ico className="h-4 w-4" />
                  {active && (
                    <Check className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-500 p-0.5 text-white" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}



/* ============= TEAM ============= */

function TeamPanel() {
  const [members, setMembers] = useState<string[]>(() => loadJSON(STAFF_KEY, STAFF));
  const [name, setName] = useState("");

  useEffect(() => {
    lsStore.setItem(STAFF_KEY, JSON.stringify(members));
    window.dispatchEvent(new Event("linecheck:staff-update"));
  }, [members]);

  const add = () => {
    const n = name.trim();
    if (!n) return;
    setMembers((m) => [n, ...m]);
    setName("");
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="New team member..."
          className="flex-1 rounded-full border border-border bg-card px-5 py-3 text-sm outline-none focus:border-foreground/30"
        />
        <button
          onClick={add}
          className="flex items-center gap-1.5 rounded-full bg-muted-foreground/80 px-5 py-3 text-sm font-semibold text-background hover:bg-foreground"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      <ul className="space-y-2">
        {members.map((m, i) => (
          <li
            key={m + i}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm"
          >
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold tracking-tight">{m}</span>
            <button
              onClick={() => setMembers((arr) => arr.filter((_, j) => j !== i))}
              className="ml-auto grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============= STATUSES ============= */

function StatusPanel() {
  const [statuses, setStatuses] = useState<string[]>(() => loadJSON(STATUSES_KEY, STATUSES));
  const [name, setName] = useState("");

  useEffect(() => {
    lsStore.setItem(STATUSES_KEY, JSON.stringify(statuses));
  }, [statuses]);

  const add = () => {
    const n = name.trim();
    if (!n) return;
    setStatuses((s) => [n.toUpperCase(), ...s]);
    setName("");
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="New status..."
          className="flex-1 rounded-full border border-border bg-card px-5 py-3 text-sm outline-none focus:border-foreground/30"
        />
        <button
          onClick={add}
          className="flex items-center gap-1.5 rounded-full bg-muted-foreground/80 px-5 py-3 text-sm font-semibold text-background hover:bg-foreground"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      <ul className="space-y-2">
        {statuses.map((s, i) => (
          <li
            key={s + i}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm"
          >
            <Tag className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold tracking-tight">{s}</span>
            <button
              onClick={() => setStatuses((arr) => arr.filter((_, j) => j !== i))}
              className="ml-auto grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============= SHIFTS ============= */

const DEFAULT_IDS = new Set(["op", "mid", "cl"]);

function slugId(label: string) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "shift";
  return base;
}

function ShiftsPanel() {
  const [shifts, setShifts] = useState<ShiftDef[]>(() => getShifts());
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const persist = (next: ShiftDef[]) => {
    setShifts(next);
    saveShifts(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 900);
  };

  const rename = (id: string, label: string) => {
    setError(null);
    const next = shifts.map((s) => (s.id === id ? { ...s, label } : s));
    persist(next);
  };

  const remove = (id: string) => {
    if (shifts.length <= 1) {
      setError("You need at least one shift.");
      return;
    }
    setError(null);
    persist(shifts.filter((s) => s.id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    const i = shifts.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= shifts.length) return;
    const next = [...shifts];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };

  const add = () => {
    const label = newLabel.trim();
    if (!label) {
      setError("Enter a shift name.");
      return;
    }
    if (shifts.some((s) => s.label.toLowerCase() === label.toLowerCase())) {
      setError("A shift with this name already exists.");
      return;
    }
    let id = slugId(label);
    const used = new Set(shifts.map((s) => s.id));
    if (used.has(id)) {
      let n = 2;
      while (used.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    setError(null);
    setNewLabel("");
    persist([...shifts, { id, label }]);
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold tracking-tight">Shifts</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Rename, reorder, add or remove shifts. Existing history for a removed
            shift stays intact and reappears if you re-add it with the same name.
          </p>
        </div>
        {saved && (
          <span className="rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-success">
            Saved
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {shifts.map((s, i) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3 py-2"
          >
            <div className="flex flex-col">
              <button
                onClick={() => move(s.id, -1)}
                disabled={i === 0}
                className="grid h-4 w-5 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Move up"
              >
                <ChevronDown className="h-3 w-3 -rotate-180" />
              </button>
              <button
                onClick={() => move(s.id, 1)}
                disabled={i === shifts.length - 1}
                className="grid h-4 w-5 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Move down"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            <input
              value={s.label}
              onChange={(e) => rename(s.id, e.target.value)}
              placeholder="Shift name"
              className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm outline-none focus:border-foreground/30"
            />
            <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
              {s.id}
              {DEFAULT_IDS.has(s.id) ? " · default" : ""}
            </span>
            <button
              onClick={() => remove(s.id)}
              className="grid h-8 w-8 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:text-danger hover:bg-danger-soft"
              aria-label={`Delete ${s.label}`}
              title="Delete shift"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={newLabel}
          onChange={(e) => {
            setNewLabel(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="New shift name (e.g. Late Night)"
          className="flex-1 min-w-[200px] rounded-full border border-border bg-background px-4 py-2 text-sm outline-none focus:border-foreground/30"
        />
        <button
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> Add Shift
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}


/* ============= SIMPLE LIST (SHELVES / CONTAINERS) ============= */


function SimpleListPanel({
  storageKey,
  defaults,
  icon,
  placeholder,
  eventName,
}: {
  storageKey: string;
  defaults: string[];
  icon: React.ReactNode;
  placeholder: string;
  eventName: string;
}) {
  const [items, setItems] = useState<string[]>(() => loadJSON(storageKey, defaults));
  const [name, setName] = useState("");

  useEffect(() => {
    lsStore.setItem(storageKey, JSON.stringify(items));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(eventName));
    }
  }, [items, storageKey, eventName]);

  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (items.some((x) => x.toLowerCase() === n.toLowerCase())) {
      setName("");
      return;
    }
    setItems((s) => [n, ...s]);
    setName("");
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={placeholder}
          className="flex-1 rounded-full border border-border bg-card px-5 py-3 text-sm outline-none focus:border-foreground/30"
        />
        <button
          onClick={add}
          className="flex items-center gap-1.5 rounded-full bg-muted-foreground/80 px-5 py-3 text-sm font-semibold text-background hover:bg-foreground"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      <ul className="space-y-2">
        {items.map((v, i) => (
          <li
            key={v + i}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm"
          >
            {icon}
            <span className="font-semibold tracking-tight">{v}</span>
            <button
              onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}
              className="ml-auto grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============= ACCESS (admin allowlist) ============= */

function AccessPanel() {
  const [emails, setEmails] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("allowed_emails")
      .select("email")
      .order("email");
    if (error) setError(error.message);
    setEmails((data ?? []).map((r) => r.email as string));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    const raw = input.trim().toLowerCase();
    if (!raw) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      setError("Enter a valid email address.");
      return;
    }
    if (emails.some((e) => e.toLowerCase() === raw)) {
      setError("This email is already on the list.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("allowed_emails")
      .insert({ email: raw, created_by: userData.user?.id ?? null });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setInput("");
    void load();
  };

  const remove = async (email: string) => {
    if (email.toLowerCase() === ADMIN_EMAIL) return;
    if (!confirm(`Remove ${email} from allowed users?`)) return;
    const { error } = await supabase
      .from("allowed_emails")
      .delete()
      .eq("email", email);
    if (error) {
      setError(error.message);
      return;
    }
    void load();
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-foreground" />
        <h3 className="text-lg font-bold">Access Control</h3>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Only the admin ({ADMIN_EMAIL}) and the emails listed below may sign in
        (Google or password). Add sub-account emails here before they attempt
        to log in.
      </p>

      <div className="mb-4 flex gap-2">
        <input
          type="email"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="user@example.com"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="flex items-center gap-1 rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {emails.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">No emails yet.</li>
          )}
          {emails.map((e) => {
            const isAdminRow = e.toLowerCase() === ADMIN_EMAIL;
            return (
              <li key={e} className="flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{e}</span>
                  {isAdminRow && (
                    <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground">
                      Admin
                    </span>
                  )}
                </div>
                {!isAdminRow && (
                  <button
                    type="button"
                    onClick={() => void remove(e)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Remove ${e}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ============= ADMINS ============= */

const ROOT_ADMINS = ["iamjiroyano@gmail.com", "hajime015@gmail.com"];

function AdminsPanel() {
  type Row = { email: string; is_admin: boolean };
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("allowed_emails")
      .select("email, is_admin")
      .eq("is_admin", true)
      .order("email");
    if (error) setError(error.message);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    const raw = input.trim().toLowerCase();
    if (!raw) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      setError("Enter a valid email address.");
      return;
    }
    if (ROOT_ADMINS.includes(raw) || rows.some((r) => r.email.toLowerCase() === raw)) {
      setError("This email is already an admin.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    // Check if the email already exists in allowed_emails
    const { data: existing } = await supabase
      .from("allowed_emails")
      .select("email")
      .ilike("email", raw)
      .maybeSingle();
    let err: string | null = null;
    if (existing) {
      const { error: uErr } = await supabase
        .from("allowed_emails")
        .update({ is_admin: true })
        .eq("email", existing.email);
      err = uErr?.message ?? null;
    } else {
      const { error: iErr } = await supabase
        .from("allowed_emails")
        .insert({ email: raw, is_admin: true, created_by: userData.user?.id ?? null });
      err = iErr?.message ?? null;
    }
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setInput("");
    void load();
  };

  const revoke = async (email: string) => {
    if (ROOT_ADMINS.includes(email.toLowerCase())) return;
    if (!confirm(`Revoke admin access from ${email}? They will remain on the allowed list.`)) return;
    const { error } = await supabase
      .from("allowed_emails")
      .update({ is_admin: false })
      .eq("email", email);
    if (error) {
      setError(error.message);
      return;
    }
    void load();
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-foreground" />
        <h3 className="text-lg font-bold">Admin Management</h3>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Admins can manage stations, team members, allowed users, and other admins.
        Root admins ({ROOT_ADMINS.join(", ")}) cannot be removed.
      </p>

      <div className="mb-4 flex gap-2">
        <input
          type="email"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="new-admin@example.com"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="flex items-center gap-1 rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add Admin
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {ROOT_ADMINS.map((e) => (
            <li key={`root-${e}`} className="flex items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">{e}</span>
                <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground">
                  Root Admin
                </span>
              </div>
            </li>
          ))}
          {rows
            .filter((r) => !ROOT_ADMINS.includes(r.email.toLowerCase()))
            .map((r) => (
              <li key={r.email} className="flex items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{r.email}</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground">
                    Admin
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void revoke(r.email)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Revoke admin ${r.email}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          {rows.filter((r) => !ROOT_ADMINS.includes(r.email.toLowerCase())).length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">No additional admins yet.</li>
          )}
        </ul>
      )}
    </section>
  );
}
