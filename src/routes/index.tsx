import { createFileRoute, Link } from "@tanstack/react-router";
import { stationSlug } from "@/lib/slug";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useShellState } from "@/components/AppShell";
import {
  getEffectiveSections,
  allFlagged,
  sectionProgress,
  type FlaggedRow,
  type Slot,
} from "@/lib/lineCheck";
import { ArrowRight, CheckCircle2, AlertTriangle, UserCog } from "lucide-react";
import { z } from "zod";


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
    for (const s of getEffectiveSections()) {
      const { done, total } = sectionProgress(s.name, shell.shift, shell.date);
      totalItems += total;
      checkedItems += done;
      if (total > 0 && done === total) stationsComplete++;
    }
    const flagged: FlaggedRow[] = allFlagged(shell.shift, shell.date);
    const readiness = totalItems ? Math.round((checkedItems / totalItems) * 100) : 0;
    return {
      totalItems,
      checkedItems,
      stationsComplete,
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
                    STATUS_BADGE[row.status] ?? "bg-danger-soft text-danger"
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
                    to="/$name"
                    params={{ name: stationSlug(row.section) }}
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
    </AppShell>
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
