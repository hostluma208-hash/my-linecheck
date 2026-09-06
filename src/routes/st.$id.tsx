import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  sharedStationPayloadSchema,
  type SharedStationPayload,
} from "@/lib/shareStation";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  MessageSquare,
  Thermometer,
  User,
} from "lucide-react";

export const Route = createFileRoute("/st/$id")({
  head: () => ({
    meta: [
      { title: "Station Board — Line Check" },
      {
        name: "description",
        content: "Read-only station board showing every shift's check status.",
      },
      { property: "og:title", content: "Station Board — Line Check" },
      {
        property: "og:description",
        content: "Read-only station board showing every shift's check status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharedStationView,
});

function SharedStationView() {
  const { id } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    payload: SharedStationPayload;
    updated_at: string;
  } | null>(null);
  const [openShifts, setOpenShifts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase.rpc("get_shared_station", { _id: id }).then(({ data: rows, error: err }) => {
      if (!active) return;
      const row = Array.isArray(rows) ? rows[0] : null;
      if (err) setError(err.message);
      else if (!row) setError("This share link no longer exists.");
      else {
        const parsed = sharedStationPayloadSchema.safeParse(row.payload);
        if (!parsed.success) setError("This shared station board is incomplete.");
        else {
          setData({
            payload: parsed.data,
            updated_at: row.updated_at ?? new Date().toISOString(),
          });
          setOpenShifts(
            Object.fromEntries(parsed.data.shifts.map((s, i) => [s.id, i === 0])),
          );
        }
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  const totals = useMemo(() => {
    const shifts = data?.payload.shifts ?? [];
    return {
      totalItems: shifts.reduce((a, s) => a + s.totalItems, 0),
      checkedItems: shifts.reduce((a, s) => a + s.checkedItems, 0),
      flagged: shifts.reduce((a, s) => a + s.flagged, 0),
    };
  }, [data]);

  const displayTemp = (rawF: string, unit: "F" | "C") => {
    const n = Number(rawF);
    if (!Number.isFinite(n)) return rawF;
    if (unit === "F") return `${n}°F`;
    return `${Math.round((((n - 32) * 5) / 9) * 10) / 10}°C`;
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4 text-center">
        <div>
          <h1 className="text-xl font-bold">Share unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error ?? "Not found."}</p>
          <Link to="/" className="mt-4 inline-block text-sm font-semibold underline">
            Go home
          </Link>
        </div>
      </div>
    );
  }

  const p = data.payload;
  const pct = totals.totalItems
    ? Math.round((totals.checkedItems / totals.totalItems) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-foreground text-sm font-bold text-background">
              {(p.brand_name || "L").charAt(0).toUpperCase()}
            </span>
            <span className="text-sm font-bold tracking-tight">{p.brand_name}</span>
          </div>
          <span className="rounded-full bg-muted/60 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Read-only
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        <p className="mb-2 text-lg font-black uppercase tracking-wide text-foreground">
          {p.brand_name}
        </p>
        <h1 className="text-2xl font-black tracking-tight">
          {p.station} · {p.date}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Last updated {new Date(data.updated_at).toLocaleString()}
        </p>

        <section className="mt-5 rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1 text-xs font-semibold">
              <Calendar className="h-3.5 w-3.5" /> {p.date}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1 text-xs font-semibold">
              <Clock className="h-3.5 w-3.5" /> {p.shifts.length} shifts
            </span>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            <Stat value={`${pct}%`} label="Checked" />
            <Stat
              value={`${totals.checkedItems}/${totals.totalItems}`}
              label="Items"
            />
            <Stat value={totals.flagged} label="Flagged" tone="text-danger" />
          </div>

          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: "var(--gradient-readiness)" }}
            />
          </div>
        </section>

        {p.shifts.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No shifts recorded for this station.
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {p.shifts.map((s) => {
              const isOpen = !!openShifts[s.id];
              const temps = Object.entries(s.temps).filter(
                ([, v]) => v && String(v).trim().length > 0,
              );
              const okCount = s.checkedItems - s.flagged;
              return (
                <section
                  key={s.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setOpenShifts((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
                    }
                    className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                    aria-expanded={isOpen}
                  >
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                        isOpen ? "rotate-0" : "-rotate-90"
                      }`}
                    />
                    <h2 className="min-w-0 flex-1 truncate text-sm font-black uppercase tracking-wider">
                      {s.label}
                    </h2>
                    {s.member && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-bold text-info">
                        <User className="h-3 w-3" /> {s.member}
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] font-bold tabular-nums text-muted-foreground">
                      {s.checkedItems}/{s.totalItems}
                    </span>
                    {okCount > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-bold text-success">
                        <CheckCircle2 className="h-3 w-3" /> {okCount}
                      </span>
                    )}
                    {s.flagged > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-bold text-danger">
                        <AlertTriangle className="h-3 w-3" /> {s.flagged}
                      </span>
                    )}
                  </button>

                  {isOpen && (
                    <div className="border-t border-border/60 px-4 py-3">
                      {temps.length > 0 && (
                        <div className="mb-3 rounded-xl bg-muted/40 p-3">
                          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            <Thermometer className="h-3.5 w-3.5" /> Temperatures
                          </p>
                          <ul className="grid gap-1 sm:grid-cols-2">
                            {temps.map(([group, value]) => (
                              <li
                                key={group}
                                className="flex items-center justify-between gap-2 text-xs"
                              >
                                <span className="truncate text-muted-foreground">
                                  {group}
                                </span>
                                <span className="font-bold tabular-nums">
                                  {displayTemp(String(value), p.tempUnit)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="space-y-4">
                        {s.categories.map((cat) => (
                          <div key={cat.group}>
                            {cat.group && (
                              <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                {cat.group}
                              </p>
                            )}
                            <ul className="space-y-2">
                              {cat.items.map((it, i) => (
                                <li
                                  key={`${cat.group}::${it.name}::${i}`}
                                  className={`rounded-xl border p-2.5 ${
                                    it.flagged
                                      ? "border-danger/40 bg-danger-soft/40"
                                      : "border-border bg-background/40"
                                  }`}
                                >
                                  <div className="flex items-start gap-2">
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-semibold">
                                        {it.name}
                                      </p>
                                      {it.note && (
                                        <p className="mt-1 text-xs text-muted-foreground">
                                          {it.note}
                                        </p>
                                      )}
                                    </div>
                                    <span
                                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                        !it.status
                                          ? "bg-muted/60 text-muted-foreground"
                                          : it.flagged
                                            ? "bg-danger-soft text-danger"
                                            : "bg-success-soft text-success"
                                      }`}
                                    >
                                      {it.status ? (
                                        it.flagged ? (
                                          <AlertTriangle className="h-3 w-3" />
                                        ) : (
                                          <CheckCircle2 className="h-3 w-3" />
                                        )
                                      ) : null}
                                      {it.status || "Not checked"}
                                    </span>
                                  </div>
                                  {it.photo && (
                                    <a
                                      href={it.photo}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-2 block overflow-hidden rounded-lg border border-border"
                                    >
                                      <img
                                        src={it.photo}
                                        alt={it.name}
                                        className="max-h-64 w-full object-cover"
                                        loading="lazy"
                                      />
                                    </a>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>

                      {(s.comment || s.commentPhotos.length > 0) && (
                        <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
                          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            <MessageSquare className="h-3.5 w-3.5" /> Notes
                          </p>
                          {s.comment && (
                            <p className="whitespace-pre-wrap text-sm">{s.comment}</p>
                          )}
                          {s.commentPhotos.length > 0 && (
                            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {s.commentPhotos.map((src, i) => (
                                <a
                                  key={i}
                                  href={src}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block overflow-hidden rounded-lg border border-border"
                                >
                                  <img
                                    src={src}
                                    alt={`${s.label} reference ${i + 1}`}
                                    className="h-32 w-full object-cover"
                                    loading="lazy"
                                  />
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          This is a read-only snapshot shared by the kitchen team.
        </p>
      </main>
    </div>
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
      <p
        className={`text-2xl font-black tabular-nums tracking-tight ${tone ?? "text-foreground"}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
