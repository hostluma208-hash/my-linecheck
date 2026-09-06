import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import { Calendar, ChevronRight, Loader2 } from "lucide-react";

const searchSchema = z.object({
  owner: z.string().optional(),
});

type SharedStationRow = {
  id: string;
  station: string;
  brand_name: string | null;
  date: string;
  updated_at: string;
};

export const Route = createFileRoute("/st/")({
  validateSearch: (s: Record<string, unknown>) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Stations — Line Check" },
      {
        name: "description",
        content: "Pick a station to view its read-only shift board.",
      },
      { property: "og:title", content: "Stations — Line Check" },
      {
        property: "og:description",
        content: "Pick a station to view its read-only shift board.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharedStationIndex,
});

function SharedStationIndex() {
  const { owner } = Route.useSearch();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stations, setStations] = useState<SharedStationRow[]>([]);

  useEffect(() => {
    let active = true;
    if (!owner) {
      setError("This link is incomplete. Ask the kitchen team for a new one.");
      setLoading(false);
      return;
    }
    supabase
      .rpc("list_shared_stations", { _owner: owner })
      .then(({ data, error: err }) => {
        if (!active) return;
        if (err) setError(err.message);
        else setStations((data as SharedStationRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [owner]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4 text-center">
        <div>
          <h1 className="text-xl font-bold">Share unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const brand = stations[0]?.brand_name || "Line Check";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-foreground text-sm font-bold text-background">
              {brand.charAt(0).toUpperCase()}
            </span>
            <span className="text-sm font-bold tracking-tight">{brand}</span>
          </div>
          <span className="rounded-full bg-muted/60 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Read-only
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-black tracking-tight">Stations</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick a station to see its shift board.
        </p>

        {stations.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No stations have been shared yet. Ask the kitchen team to share a
            station first.
          </div>
        ) : (
          <ul className="mt-6 grid gap-3">
            {stations.map((s) => (
              <li key={s.id}>
                <Link
                  to="/st/$id"
                  params={{ id: s.id }}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black uppercase tracking-wider">
                      {s.station}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Calendar className="h-3 w-3" /> {s.date} · updated{" "}
                      {new Date(s.updated_at).toLocaleString()}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-8 text-center text-[11px] text-muted-foreground">
          These are read-only snapshots shared by the kitchen team.
        </p>
      </main>
    </div>
  );
}
