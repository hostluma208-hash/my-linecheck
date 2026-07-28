import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useShellState } from "@/components/AppShell";
import {
  SECTIONS,
  FLAG_STATUSES,
  loadSection,
  loadMember,
  SLOT_LABEL,
  shiftHistory,
  getEffectiveSections,
  effectiveCategorizedItems,
  readEntry,
  getShifts,
  type Slot,
} from "@/lib/lineCheck";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Share2,
  User,
  Calendar,
  Clock,
  Edit3,
} from "lucide-react";
import { z } from "zod";

const searchSchema = z.object({
  date: z.string(),
  shift: z.string(),
});

export const Route = createFileRoute("/history/shift")({
  validateSearch: (s) => searchSchema.parse(s),
  head: ({ match }) => {
    const { date, shift } = (match as unknown as { search: { date: string; shift: Slot } }).search;
    return {
      meta: [
        { title: `${SLOT_LABEL[shift]} · ${date} — Line Check` },
        { name: "description", content: `Shift detail for ${SLOT_LABEL[shift]} on ${date}.` },
      ],
    };
  },
  component: ShiftDetail,
});

function ShiftDetail() {
  const { date, shift } = Route.useSearch() as { date: string; shift: Slot };
  const shell = useShellState(`${SLOT_LABEL[shift]} — ${date}`);
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(0);

  // Sync the shell pickers to the params being viewed.
  useEffect(() => {
    if (shell.date !== date) shell.setDate(date);
    if (shell.shift !== shift) shell.setShift(shift);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, shift]);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    window.addEventListener("linecheck:update", fn);
    window.addEventListener("linecheck:scope-change", fn);
    return () => {
      window.removeEventListener("linecheck:update", fn);
      window.removeEventListener("linecheck:scope-change", fn);
    };
  }, []);

  const summary = useMemo(
    () => shiftHistory(date, shift),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, shift, tick],
  );

  const rows = useMemo(() => {
    type Row = {
      section: string;
      item: string;
      status: string;
      note: string;
      flagged: boolean;
    };
    const out: { section: string; items: Row[] }[] = [];
    for (const sec of getEffectiveSections()) {
      const state = loadSection(sec.name, date);
      const items: Row[] = [];
      for (const cat of effectiveCategorizedItems(sec.name)) {
        for (const it of cat.items) {
          const e = readEntry(state, cat.group, it.name, shift);
          if (!e?.status) continue;
          items.push({
            section: sec.name,
            item: it.name,
            status: e.status,
            note: e.note || "",
            flagged: FLAG_STATUSES.has(e.status),
          });
        }
      }
      if (items.length) out.push({ section: sec.name, items });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, shift, tick]);

  const share = async () => {
    try {
      const { publishSharedShift } = await import("@/lib/share");
      const url = await publishSharedShift(date, shift);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        window.prompt("Copy share link:", url);
      }
    } catch (e) {
      console.error(e);
      window.alert("Could not create share link. Please try again.");
    }
  };

  const member = summary.member || loadMember(date, shift);
  const pct = summary.totalItems
    ? Math.round((summary.checkedItems / summary.totalItems) * 100)
    : 0;

  return (
    <AppShell {...shell}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate({ to: "/history" })}
          className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-accent"
          aria-label="Back to history"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-base font-bold tracking-tight">Shift Detail</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {getShifts().map((sh) => (
            <Link
              key={sh.id}
              to="/history/shift"
              search={{ date, shift: sh.id }}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                sh.id === shift
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-accent"
              }`}
            >
              {sh.label}
            </Link>
          ))}
          <button
            onClick={share}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-accent"
          >
            {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Share2 className="h-3.5 w-3.5" />}
            {copied ? "Link copied" : "Share"}
          </button>
        </div>
      </div>

      <section className="rounded-3xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1 text-xs font-semibold">
            <Calendar className="h-3.5 w-3.5" /> {date}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1 text-xs font-semibold">
            <Clock className="h-3.5 w-3.5" /> {SLOT_LABEL[shift]}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-3 py-1 text-xs font-semibold text-info">
            <User className="h-3.5 w-3.5" /> {member || "Unassigned"}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat value={summary.stationsTouched} label="Stations" />
          <Stat value={summary.stationsComplete} label="Complete" tone="text-success" />
          <Stat value={`${summary.checkedItems}/${summary.totalItems}`} label="Items" />
          <Stat value={summary.flagged} label="Flagged" tone="text-danger" />
        </div>

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: "var(--gradient-readiness)" }}
          />
        </div>
      </section>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No items recorded for this shift.
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {rows.map((r) => (
            <section key={r.section}>
              <div className="mb-2 flex items-center gap-2 px-1">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  {r.section}
                </h3>
                <Link
                  to="/section/$name"
                  params={{ name: r.section }}
                  search={{ date, shift }}
                  className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground hover:bg-accent"
                  title="Reopen this shift for editing"
                >
                  <Edit3 className="h-3 w-3" />
                  Reopen
                </Link>
              </div>
              <ul className="space-y-2">
                {r.items.map((it) => (
                  <li
                    key={it.item}
                    className={`rounded-2xl border bg-card p-3 ${
                      it.flagged ? "border-rose-200" : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{it.item}</p>
                        {it.note && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{it.note}</p>
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                          it.flagged
                            ? "bg-danger-soft text-danger"
                            : "bg-success-soft text-success"
                        }`}
                      >
                        {it.flagged ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        {it.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl bg-muted/40 px-4 py-3">
      <p className={`text-2xl font-black tabular-nums tracking-tight ${tone ?? "text-foreground"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
