import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useShellState, SECTION_ICONS } from "@/components/AppShell";
import {
  getEffectiveSections,
  allFlagged,
  sectionProgress,
  type FlaggedRow,
  type Slot,
} from "@/lib/lineCheck";
import { ArrowRight, CheckCircle2, AlertTriangle, Utensils, UserCog, GripVertical } from "lucide-react";
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getStationOrder, setStationOrder, applyOrder } from "@/lib/order";


const dashSearch = z
  .object({
    date: z.string().optional(),
    shift: z.string().optional(),
  })
  .partial();

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>) => dashSearch.parse(s),
  head: () => ({
    meta: [
      { title: "Shift Overview — Line Check 2026" },
      {
        name: "description",
        content: "Kitchen shift readiness dashboard: station progress and flagged items.",
      },
      { property: "og:title", content: "Shift Overview — Line Check 2026" },
    ],
  }),
  component: Dashboard,
});

const STATUS_BADGE: Record<string, string> = {
  EXPIRED: "bg-danger-soft text-danger",
  "ABOUT TO EXPIRE": "bg-warning-soft text-foreground",
  "NEED TO CLEAN": "bg-info-soft text-info",
  "WRONG LABEL": "bg-violet-soft text-violet",
};

function Dashboard() {
  const shell = useShellState("Shift Overview");
  const search = Route.useSearch() as { date?: string; shift?: Slot };
  const [tick, setTick] = useState(0);

  // Sync shell to search params when reopening a past shift from history.
  useEffect(() => {
    if (search.date && search.date !== shell.date) shell.setDate(search.date);
    if (search.shift && search.shift !== shell.shift) shell.setShift(search.shift);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.date, search.shift]);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    window.addEventListener("storage", fn);
    window.addEventListener("linecheck:update", fn);
    return () => {
      window.removeEventListener("storage", fn);
      window.removeEventListener("linecheck:update", fn);
    };
  }, []);

  const stats = useMemo(() => {
    let totalItems = 0;
    let checkedItems = 0;
    let stationsComplete = 0;
    const perStation: { name: string; done: number; total: number; pct: number }[] = [];
    for (const s of getEffectiveSections()) {
      const { done, total } = sectionProgress(s.name, shell.shift, shell.date);
      totalItems += total;
      checkedItems += done;
      const pct = total ? Math.round((done / total) * 100) : 0;
      if (total > 0 && done === total) stationsComplete++;
      perStation.push({ name: s.name, done, total, pct });
    }
    const flagged: FlaggedRow[] = allFlagged(shell.shift, shell.date);
    const readiness = totalItems ? Math.round((checkedItems / totalItems) * 100) : 0;
    return {
      totalItems,
      checkedItems,
      stationsComplete,
      perStation,
      flagged,
      readiness,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.shift, shell.date, tick]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();
  const name = shell.member || "Chef";

  return (
    <AppShell {...shell}>
      {!shell.member && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <UserCog className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-bold">Select a team member to start</p>
            <p className="text-xs opacity-80">
              Pick your name from the Team Member picker in the top bar before opening a station.
            </p>
          </div>
        </div>
      )}
      {/* Hero readiness card */}
      <section className="rounded-3xl border border-border bg-card p-6 lg:p-8">
        <p className="text-sm text-muted-foreground">
          {greeting}, <span className="font-medium text-foreground">{name}</span>.
        </p>
        <p className="mt-1 text-sm">
          You have{" "}
          <span className="font-semibold text-success">{stats.stationsComplete}</span>{" "}
          stations ready and{" "}
          <span className="font-semibold text-danger">{stats.flagged.length}</span> items
          flagged.
        </p>

        <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-end">
          <div className="flex items-end gap-1">
            <span className="text-7xl font-black leading-none tracking-tight text-foreground lg:text-8xl">
              {stats.readiness}
            </span>
            <span className="pb-3 text-2xl font-medium text-muted-foreground">%</span>
          </div>
          <div className="flex-1">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Shift Readiness
            </p>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${stats.readiness}%`,
                  background: "var(--gradient-readiness)",
                }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {stats.checkedItems} of {stats.totalItems} items checked
            </p>
          </div>
        </div>
      </section>

      {/* Stat cards */}
      <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5 text-success" />}
          iconBg="bg-success-soft"
          label="Stations Complete"
          value={stats.stationsComplete}
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5 text-warning" />}
          iconBg="bg-warning-soft"
          label="Flagged Items"
          value={stats.flagged.length}
        />
      </section>

      {/* Flagged details */}
      <section className="mt-6 rounded-3xl border border-border bg-card">
        <header className="flex items-center justify-between px-6 py-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Flagged Details
          </h2>
          <span className="text-xs text-muted-foreground">
            {stats.flagged.length} {stats.flagged.length === 1 ? "item" : "items"}
          </span>
        </header>
        <ul className="divide-y divide-border">
          {stats.flagged.length === 0 && (
            <li className="px-6 py-10 text-center text-sm text-muted-foreground">
              No flagged items for this shift. 🎉
            </li>
          )}
          {stats.flagged.map((row) => {
            const rowInner = (
              <>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-danger-soft text-danger">
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1 truncate text-sm font-medium text-foreground">
                  {row.item}
                </span>
                <span className="hidden text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:inline">
                  {row.section}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    STATUS_BADGE[row.status] ?? "bg-muted text-foreground"
                  }`}
                >
                  {row.status}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </>
            );
            return (
              <li key={`${row.section}-${row.item}`}>
                {shell.member ? (
                  <Link
                    to="/section/$name"
                    params={{ name: row.section }}
                    className="flex items-center gap-3 px-6 py-3.5 hover:bg-accent"
                  >
                    {rowInner}
                  </Link>
                ) : (
                  <div
                    aria-disabled
                    title="Select a team member first"
                    className="flex cursor-not-allowed items-center gap-3 px-6 py-3.5 opacity-60"
                  >
                    {rowInner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Stations grid */}
      <StationsGrid stations={stats.perStation} disabled={!shell.member} />
    </AppShell>
  );
}

function StationsGrid({
  stations,
  disabled,
}: {
  stations: { name: string; done: number; total: number; pct: number }[];
  disabled: boolean;
}) {
  const [order, setOrderState] = useState<string[]>(() => getStationOrder());

  useEffect(() => {
    const refresh = () => setOrderState(getStationOrder());
    window.addEventListener("linecheck:scope-change", refresh);
    return () => window.removeEventListener("linecheck:scope-change", refresh);
  }, []);

  const ordered = useMemo(
    () => applyOrder(stations, order, (s) => s.name),
    [stations, order],
  );
  const ids = ordered.map((s) => s.name);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    setOrderState(next);
    setStationOrder(next);
  };

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        Stations
      </h2>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((s) => (
              <SortableStationCard key={s.name} station={s} disabled={disabled} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}

function SortableStationCard({
  station: s,
  disabled,
}: {
  station: { name: string; done: number; total: number; pct: number };
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: s.name,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const Icon = SECTION_ICONS[s.name] ?? Utensils;
  const cardInner = (
    <>
      <div className="flex items-center gap-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.preventDefault()}
          aria-label={`Reorder ${s.name}`}
          className="grid h-7 w-5 shrink-0 cursor-grab place-items-center rounded text-muted-foreground hover:bg-accent active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-muted text-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{s.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {s.done}/{s.total} checked
          </p>
        </div>
        <span className="text-xs font-bold tabular-nums text-foreground">{s.pct}%</span>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${s.pct}%`, background: "var(--gradient-readiness)" }}
        />
      </div>
    </>
  );
  if (disabled) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        aria-disabled
        title="Select a team member first"
        className="group cursor-not-allowed rounded-2xl border border-dashed border-border bg-card p-4 opacity-60"
      >
        {cardInner}
      </div>
    );
  }
  return (
    <div ref={setNodeRef} style={style}>
      <Link
        to="/section/$name"
        params={{ name: s.name }}
        className="group block rounded-2xl border border-border bg-card p-4 transition-all hover:border-foreground/20 hover:shadow-sm"
      >
        {cardInner}
      </Link>
    </div>
  );
}


function StatCard({
  icon,
  iconBg,
  label,
  value,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <span className={`grid h-9 w-9 place-items-center rounded-full ${iconBg}`}>{icon}</span>
      <p className="mt-4 text-4xl font-black tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
