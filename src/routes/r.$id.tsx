import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  sharedReceivingPayloadSchema,
  type SharedReceivingPayload,
} from "@/lib/shareReceiving";
import { Calendar, Clock, Loader2, PackageCheck, Truck, User } from "lucide-react";

export const Route = createFileRoute("/r/$id")({
  head: () => ({
    meta: [
      { title: "Shared Receiving — Line Check" },
      { name: "description", content: "Read-only shared receiving checklist." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharedReceivingView,
});

function SharedReceivingView() {
  const { id } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    payload: SharedReceivingPayload;
    brand: string;
    updated_at: string;
  } | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase
      .rpc("get_shared_receiving", { _id: id })
      .then(({ data: rows, error: err }) => {
        if (!active) return;
        const row = Array.isArray(rows) ? rows[0] : null;
        if (err) setError(err.message);
        else if (!row) setError("This share link no longer exists.");
        else {
          const parsed = sharedReceivingPayloadSchema.safeParse(row.payload);
          if (!parsed.success) {
            console.error("[shared receiving] invalid payload", parsed.error);
            setError("This shared receiving is incomplete or corrupted.");
          } else {
            setData({
              payload: parsed.data,
              brand: row.brand_name || "LUMA",
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

  const r = data.payload;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-foreground text-background text-sm font-bold">
              {(data.brand || "L").charAt(0).toUpperCase()}
            </span>
            <span className="text-sm font-bold tracking-tight">{data.brand}</span>
          </div>
          <span className="rounded-full bg-muted/60 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Read-only
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        <p className="mb-2 text-lg font-black uppercase tracking-wide text-foreground">
          {data.brand}
        </p>
        <div className="flex items-center gap-3">

          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Receiving Checklist</h1>
            <p className="text-xs text-muted-foreground">
              Last updated {new Date(data.updated_at).toLocaleString()}
            </p>
          </div>
        </div>

        <section className="mt-5 rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Chip icon={<Calendar className="h-3.5 w-3.5" />}>{r.date || "—"}</Chip>
            <Chip icon={<Clock className="h-3.5 w-3.5" />}>{r.time || "—"}</Chip>
            {r.branch && <Chip>{r.branch}</Chip>}
            {r.driver && <Chip icon={<Truck className="h-3.5 w-3.5" />}>{r.driver}</Chip>}
            {(r.receiverName || r.checkedBy) && (
              <Chip icon={<User className="h-3.5 w-3.5" />}>{r.receiverName || r.checkedBy}</Chip>
            )}
          </div>

          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <Info label="Delivery Note / Invoice #" value={r.deliveryNote} />
            <Info label="Purchase Order #" value={r.purchaseOrder} />
            <Info
              label="Chiller Car Temp"
              value={r.chillerCarTemp ? `${r.chillerCarTemp} °C` : ""}
            />
            <Info
              label="Product Temp"
              value={r.productTemp ? `${r.productTemp} °C` : ""}
            />
            <Info label="Checked by" value={r.checkedBy} />
            <Info label="Signature" value={r.signature} />
          </dl>
        </section>

        <div className="mt-6 grid gap-3">
          <ChecklistView title="1. Temperature Check" checks={r.tempChecks} />
          <ChecklistView title="2. Quantity Check" checks={r.quantityChecks} />
          <ChecklistView title="3. Quality Check" checks={r.qualityChecks} />
        </div>

        {r.comments && (
          <section className="mt-6 rounded-2xl border border-border bg-card p-4">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Comments
            </p>
            <p className="whitespace-pre-wrap text-sm">{r.comments}</p>
          </section>
        )}

        {r.photos.length > 0 && (
          <section className="mt-6">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Photos ({r.photos.length})
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {r.photos.map((src, i) => (
                <button
                  key={i}
                  onClick={() => setViewer(src)}
                  className="aspect-square overflow-hidden rounded-lg border border-border"
                >
                  <img src={src} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      {viewer && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setViewer(null)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
        >
          <img src={viewer} alt="Photo" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

function Chip({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1 text-xs font-semibold">
      {icon}
      {children}
    </span>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value || "—"}</dd>
    </div>
  );
}

function ChecklistView({
  title,
  checks,
}: {
  title: string;
  checks: Record<string, boolean>;
}) {
  const items = Object.keys(checks || {});
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No items.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((it) => (
            <li key={it} className="flex items-center gap-2">
              <span
                className={`grid h-4 w-4 place-items-center rounded border ${
                  checks[it]
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background"
                }`}
              >
                {checks[it] ? "✓" : ""}
              </span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
