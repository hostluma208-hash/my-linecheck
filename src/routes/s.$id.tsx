import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  FLAG_STATUSES,
  SLOT_LABEL,
  entryKey,
  type Slot,
} from "@/lib/lineCheck";
import {
  sharedShiftPayloadSchema,
  type SharedShiftPayload,
} from "@/lib/share";
import {
  AlertTriangle,
  CheckCircle2,
  User,
  Calendar,
  Clock,
  Loader2,
  ChevronDown,
  Thermometer,
  MessageSquare,
} from "lucide-react";

export const Route = createFileRoute("/s/$id")({
  head: () => ({
    meta: [
      { title: "Shared Shift — Line Check" },
      { name: "description", content: "Read-only shared shift report." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharedView,
});



function SharedView() {
  const { id } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    payload: SharedShiftPayload;
    updated_at: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase
      .rpc("get_shared_shift", { _id: id })
      .then(({ data: rows, error: err }) => {
        if (!active) return;
        const row = Array.isArray(rows) ? rows[0] : null;
        if (err) {
          setError(err.message);
        } else if (!row) {
          setError("This share link no longer exists.");
        } else {
          const parsed = sharedShiftPayloadSchema.safeParse(row.payload);
          if (!parsed.success) {
            console.error("[shared shift] invalid payload", parsed.error);
            setError("This shared shift is incomplete or corrupted.");
          } else {
            setData({
              payload: parsed.data,
              updated_at: row.updated_at ?? new Date().toISOString(),
            });
          }
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const [openStations, setOpenStations] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    if (!data) return [];
    const slot: Slot = data.payload.shift;

    type Item = {
      item: string;
      status: string;
      note: string;
      photo?: string;
      flagged: boolean;
    };
    type CategoryBlock = { group: string; items: Item[] };
    const out: {
      section: string;
      categories: CategoryBlock[];
      itemCount: number;
      flaggedCount: number;
      okCount: number;
      photoCount: number;
      temps: { group: string; value: string }[];
      tempUnit: "F" | "C";
      comment: string;
      commentPhotos: string[];
    }[] = [];


    for (const s of data.payload.sections) {
      const st = s.state;
      const entries = st.entries ?? {};
      const seen = new Set<string>();
      const categories: CategoryBlock[] = [];

      // Preferred: use the section's category arrangement from the payload.
      const cats = Array.isArray(s.categories) ? s.categories : [];
      for (const cat of cats) {
        const items: Item[] = [];
        for (const it of cat.items ?? []) {
          const key = entryKey(cat.group, it.name);
          const legacy = entries[it.name]?.[slot];
          const e = entries[key]?.[slot] ?? legacy;
          if (!e?.status) continue;
          seen.add(key);
          if (legacy && !entries[key]) seen.add(it.name);
          items.push({
            item: it.name,
            status: e.status,
            note: e.note || "",
            photo: e.photo,
            flagged: FLAG_STATUSES.has(e.status),
          });
        }
        if (items.length) categories.push({ group: cat.group, items });
      }

      // Fallback: surface any recorded entries that weren't matched above
      // (e.g. old shares without category info, or items since removed).
      const leftover: Record<string, Item[]> = {};
      for (const [key, byslot] of Object.entries(entries)) {
        if (seen.has(key)) continue;
        const e = byslot?.[slot];
        if (!e?.status) continue;
        const group = key.includes("::") ? key.split("::")[0] : "";
        const itemName = key.includes("::")
          ? key.split("::").slice(1).join("::")
          : key;
        (leftover[group] ||= []).push({
          item: itemName,
          status: e.status,
          note: e.note || "",
          photo: e.photo,
          flagged: FLAG_STATUSES.has(e.status),
        });
      }
      for (const [group, items] of Object.entries(leftover)) {
        const existing = categories.find((c) => c.group === group);
        if (existing) existing.items.push(...items);
        else categories.push({ group, items });
      }

      const allItems = categories.flatMap((c) => c.items);
      const flaggedCount = allItems.filter((i) => i.flagged).length;
      const okCount = allItems.length - flaggedCount;
      const photoCount = allItems.filter((i) => i.photo).length;
      const temps = Object.entries(s.temps ?? {})
        .filter(([, v]) => v && String(v).trim().length > 0)
        .map(([group, value]) => ({ group, value: String(value) }));
      const comment = (s.comment || "").trim();
      const commentPhotos = Array.isArray(s.commentPhotos)
        ? s.commentPhotos.filter((p) => typeof p === "string" && p.length > 0)
        : [];
      if (allItems.length || temps.length || comment || commentPhotos.length) {
        out.push({
          section: s.name,
          categories,
          itemCount: allItems.length,
          flaggedCount,
          okCount,
          photoCount,
          temps,
          tempUnit: s.tempUnit ?? "F",
          comment,
          commentPhotos,
        });
      }

    }
    return out;
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
  const slot = p.shift as Slot;
  const pct = p.summary.totalItems
    ? Math.round((p.summary.checkedItems / p.summary.totalItems) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-foreground text-background text-sm font-bold">
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
        <h1 className="text-2xl font-black tracking-tight">
          {SLOT_LABEL[slot]} Shift · {p.date}
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
              <Clock className="h-3.5 w-3.5" /> {SLOT_LABEL[slot]}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-3 py-1 text-xs font-semibold text-info">
              <User className="h-3.5 w-3.5" /> {p.member || "Unassigned"}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={p.summary.stationsTouched} label="Stations" />
            <Stat value={p.summary.stationsComplete} label="Complete" tone="text-success" />
            <Stat value={`${p.summary.checkedItems}/${p.summary.totalItems}`} label="Items" />
            <Stat value={p.summary.flagged} label="Flagged" tone="text-danger" />
          </div>

          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: "var(--gradient-readiness)" }}
            />
          </div>
        </section>

        {grouped.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No items recorded for this shift.
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {grouped.map((r) => {
              const flaggedCount = r.flaggedCount;
              const okCount = r.okCount;
              const isOpen = !!openStations[r.section];
              const photoCount = r.photoCount;
              return (
                <section
                  key={r.section}
                  className="overflow-hidden rounded-2xl border border-border bg-card"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setOpenStations((prev) => ({ ...prev, [r.section]: !prev[r.section] }))
                    }
                    className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                    aria-expanded={isOpen}
                  >
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                        isOpen ? "rotate-0" : "-rotate-90"
                      }`}
                    />
                    <h3 className="min-w-0 flex-1 truncate text-sm font-black uppercase tracking-wider">
                      {r.section}
                    </h3>
                    {r.temps.length > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-bold text-info">
                        <Thermometer className="h-3 w-3" /> {r.temps.length}
                      </span>
                    )}
                    {photoCount > 0 && (
                      <span className="inline-flex shrink-0 items-center rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                        📷 {photoCount}
                      </span>
                    )}
                    {okCount > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-bold text-success">
                        <CheckCircle2 className="h-3 w-3" /> {okCount}
                      </span>
                    )}
                    {flaggedCount > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-bold text-danger">
                        <AlertTriangle className="h-3 w-3" /> {flaggedCount}
                      </span>
                    )}
                  </button>

                  {isOpen && (
                    <div className="border-t border-border/60 px-4 py-3">
                      {r.temps.length > 0 && (
                        <div className="mb-3 rounded-xl bg-muted/40 p-3">
                          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            <Thermometer className="h-3.5 w-3.5" /> Temperatures
                          </p>
                          <ul className="grid gap-1 sm:grid-cols-2">
                            {r.temps.map((t) => (
                              <li key={t.group} className="flex items-center justify-between gap-2 text-xs">
                                <span className="truncate text-muted-foreground">{t.group}</span>
                                <span className="font-bold tabular-nums">
                                  {displayTemp(t.value, r.tempUnit)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {r.itemCount === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No items were checked for this station.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {r.categories.map((cat) => (
                            <div key={cat.group}>
                              {cat.group && (
                                <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                                  {cat.group}
                                </p>
                              )}
                              <ul className="space-y-2">
                                {cat.items.map((it) => (
                                  <li
                                    key={`${cat.group}::${it.item}`}
                                    className={`rounded-xl border p-2.5 ${
                                      it.flagged
                                        ? "border-rose-200 bg-rose-50/40"
                                        : "border-border bg-background/40"
                                    }`}
                                  >
                                    <div className="flex items-start gap-2">
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-semibold">{it.item}</p>
                                        {it.note && (
                                          <p className="mt-1 text-xs text-muted-foreground">{it.note}</p>
                                        )}
                                      </div>
                                      <span
                                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
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
                                    {it.photo && (
                                      <a
                                        href={it.photo}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-2 block overflow-hidden rounded-lg border border-border"
                                      >
                                        <img
                                          src={it.photo}
                                          alt={it.item}
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
                      )}


                      {(r.comment || r.commentPhotos.length > 0) && (
                        <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
                          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            <MessageSquare className="h-3.5 w-3.5" /> Notes
                          </p>
                          {r.comment && (
                            <p className="whitespace-pre-wrap text-sm">{r.comment}</p>
                          )}
                          {r.commentPhotos.length > 0 && (
                            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {r.commentPhotos.map((src, i) => (
                                <a
                                  key={i}
                                  href={src}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block overflow-hidden rounded-lg border border-border"
                                >
                                  <img
                                    src={src}
                                    alt={`${r.section} reference ${i + 1}`}
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
      <p className={`text-2xl font-black tabular-nums tracking-tight ${tone ?? "text-foreground"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
