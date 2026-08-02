import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useShellState } from "@/components/AppShell";
import { lsStore } from "@/lib/lsStore";
import { compressImageFile } from "@/lib/image";
import { Camera, Trash2, X, PackageCheck, Plus, ChevronDown, ChevronUp, Pencil, Image as ImageIcon, Check as CheckIcon, Share2 } from "lucide-react";
import { publishSharedReceiving } from "@/lib/shareReceiving";

export const Route = createFileRoute("/receiving")({
  head: () => ({
    meta: [
      { title: "Store Receiving Item Checklist — Line Check 2026" },
      { name: "description", content: "Log incoming deliveries with temperature, quantity, and quality checks plus proof photos." },
    ],
  }),
  component: ReceivingPage,
});

const LS_KEY = "linecheck:receiving";
const TEMPLATE_KEY = "linecheck:receiving-template";

/* --- Default checklist items (mirrors the paper form). Users can edit these. --- */
const DEFAULT_TEMP_ITEMS = [
  "Cold items: 0°C to 5°C",
  "Frozen items -18°C or lower",
  "Hot items: 57°C or higher",
];
const DEFAULT_QUANTITY_ITEMS = [
  "All items delivered",
  "Quantities match order",
  "No missing, extra, or incorrect items",
];
const DEFAULT_QUALITY_ITEMS = [
  "Packing clean and undamaged",
  "Delivery box is cleaned and has no bad odor",
  "No tempering or contamination",
  "Items in good condition",
  "Expiry date is valid",
];

type Template = { temp: string[]; quantity: string[]; quality: string[] };

function loadTemplate(): Template {
  try {
    const raw = lsStore.getItem(TEMPLATE_KEY);
    if (raw) {
      const t = JSON.parse(raw);
      if (t && Array.isArray(t.temp) && Array.isArray(t.quantity) && Array.isArray(t.quality)) {
        return t;
      }
    }
  } catch { /* ignore */ }
  return { temp: [...DEFAULT_TEMP_ITEMS], quantity: [...DEFAULT_QUANTITY_ITEMS], quality: [...DEFAULT_QUALITY_ITEMS] };
}
function saveTemplate(t: Template) {
  lsStore.setItem(TEMPLATE_KEY, JSON.stringify(t));
}

type Checks = Record<string, boolean>;

type ReceivingRecord = {
  id: string;
  createdAt: string;
  date: string;
  time: string;
  branch: string;
  driver: string;
  deliveryNote: string;   // Delivery Note / Invoice #
  purchaseOrder: string;  // Purchase Order #
  chillerCarTemp: string; // °C
  productTemp: string;    // °C
  tempChecks: Checks;
  quantityChecks: Checks;
  qualityChecks: Checks;
  receiverName: string;
  signature: string;
  comments: string;
  checkedBy: string;      // kept for filtering / history
  photos: string[];
};

function loadRecords(): ReceivingRecord[] {
  try {
    const raw = lsStore.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveRecords(list: ReceivingRecord[]) {
  lsStore.setItem(LS_KEY, JSON.stringify(list));
}
function nowParts() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
function emptyChecks(items: string[]): Checks {
  return Object.fromEntries(items.map((i) => [i, false]));
}

function ReceivingPage() {
  const shell = useShellState("Store Receiving Item Checklist");
  const [records, setRecords] = useState<ReceivingRecord[]>(() => loadRecords());
  const [template, setTemplate] = useState<Template>(() => loadTemplate());
  const [form, setForm] = useState(() => {
    const { date, time } = nowParts();
    const t = loadTemplate();
    return {
      date,
      time,
      branch: "",
      driver: "",
      deliveryNote: "",
      purchaseOrder: "",
      chillerCarTemp: "",
      productTemp: "",
      tempChecks: emptyChecks(t.temp),
      quantityChecks: emptyChecks(t.quantity),
      qualityChecks: emptyChecks(t.quality),
      receiverName: "",
      signature: "",
      comments: "",
      checkedBy: "",
      photos: [] as string[],
    };
  });
  // Team members managed in Settings → Team Members tab
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  useEffect(() => {
    const read = () => {
      try {
        const raw = lsStore.getItem("linecheck:settings:members");
        const parsed = raw ? JSON.parse(raw) : null;
        setTeamMembers(Array.isArray(parsed) ? parsed : []);
      } catch {
        setTeamMembers([]);
      }
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    window.addEventListener("linecheck:members-update", read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener("focus", read);
      window.removeEventListener("linecheck:members-update", read);
    };
  }, []);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);


  useEffect(() => {
    const refresh = () => { setRecords(loadRecords()); setTemplate(loadTemplate()); };
    window.addEventListener("linecheck:update", refresh);
    window.addEventListener("linecheck:scope-change", refresh);
    return () => {
      window.removeEventListener("linecheck:update", refresh);
      window.removeEventListener("linecheck:scope-change", refresh);
    };
  }, []);

  /* Template mutations (persist + keep current form's checks in sync) */
  function updateTemplateGroup(
    group: keyof Template,
    updater: (arr: string[]) => string[],
  ) {
    setTemplate((prev) => {
      const nextArr = updater(prev[group]);
      const next = { ...prev, [group]: nextArr };
      saveTemplate(next);
      // Keep form checks aligned with the new item list
      const checksKey = ({ temp: "tempChecks", quantity: "quantityChecks", quality: "qualityChecks" } as const)[group];
      setForm((f) => {
        const oldChecks = f[checksKey] as Checks;
        const rebuilt: Checks = {};
        nextArr.forEach((it) => { rebuilt[it] = !!oldChecks[it]; });
        return { ...f, [checksKey]: rebuilt };
      });
      return next;
    });
  }
  const addTemplateItem = (group: keyof Template, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    updateTemplateGroup(group, (arr) => (arr.includes(clean) ? arr : [...arr, clean]));
  };
  const renameTemplateItem = (group: keyof Template, oldName: string, newName: string) => {
    const clean = newName.trim();
    if (!clean || clean === oldName) return;
    updateTemplateGroup(group, (arr) => arr.map((x) => (x === oldName ? clean : x)));
  };
  const removeTemplateItem = (group: keyof Template, name: string) => {
    updateTemplateGroup(group, (arr) => arr.filter((x) => x !== name));
  };


  const sorted = useMemo(
    () => [...records].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [records],
  );

  async function addPhoto(file: File | null | undefined) {
    if (!file) return;
    try {
      const dataUrl = await compressImageFile(file);
      setForm((f) => ({ ...f, photos: [...f.photos, dataUrl] }));
    } catch (e) {
      console.warn("photo failed", e);
    }
  }
  function removePhoto(idx: number) {
    setForm((f) => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }));
  }

  function toggle(group: "tempChecks" | "quantityChecks" | "qualityChecks", key: string) {
    setForm((f) => ({ ...f, [group]: { ...f[group], [key]: !f[group][key] } }));
  }

  function resetForm() {
    const { date, time } = nowParts();
    setEditingId(null);
    setForm({
      date, time,
      branch: "",
      driver: "",
      deliveryNote: "",
      purchaseOrder: "",
      chillerCarTemp: "",
      productTemp: "",
      tempChecks: emptyChecks(template.temp),
      quantityChecks: emptyChecks(template.quantity),
      qualityChecks: emptyChecks(template.quality),
      receiverName: "",
      signature: "",
      comments: "",
      checkedBy: "",
      photos: [],
    });
  }

  function editRecord(r: ReceivingRecord) {
    setEditingId(r.id);
    setForm({
      date: r.date,
      time: r.time,
      branch: r.branch,
      driver: r.driver,
      deliveryNote: r.deliveryNote,
      purchaseOrder: r.purchaseOrder,
      chillerCarTemp: r.chillerCarTemp,
      productTemp: r.productTemp,
      tempChecks: { ...r.tempChecks },
      quantityChecks: { ...r.quantityChecks },
      qualityChecks: { ...r.qualityChecks },
      receiverName: r.receiverName,
      signature: r.signature ?? "",
      comments: r.comments,
      checkedBy: r.checkedBy,
      photos: [...r.photos],
    });
    setExpanded(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function submit() {
    if (!form.receiverName.trim() && !form.checkedBy.trim()) {
      alert("Please enter the Receiver name (or select who checked).");
      return;
    }
    const values = {
      date: form.date,
      time: form.time,
      branch: form.branch.trim(),
      driver: form.driver.trim(),
      deliveryNote: form.deliveryNote.trim(),
      purchaseOrder: form.purchaseOrder.trim(),
      chillerCarTemp: form.chillerCarTemp.trim(),
      productTemp: form.productTemp.trim(),
      tempChecks: form.tempChecks,
      quantityChecks: form.quantityChecks,
      qualityChecks: form.qualityChecks,
      receiverName: form.receiverName.trim(),
      signature: form.signature.trim(),
      comments: form.comments.trim(),
      checkedBy: (form.checkedBy || form.receiverName).trim(),
      photos: form.photos,
    };
    if (editingId) {
      const next = records.map((r) => (r.id === editingId ? { ...r, ...values } : r));
      setRecords(next);
      saveRecords(next);
      resetForm();
      return;
    }
    const rec: ReceivingRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...values,
    };
    const next = [rec, ...records];
    setRecords(next);
    saveRecords(next);
    resetForm();
  }


  function deleteRecord(id: string) {
    if (!confirm("Delete this receiving record?")) return;
    const next = records.filter((r) => r.id !== id);
    setRecords(next);
    saveRecords(next);
  }

  async function shareRecord(r: ReceivingRecord) {
    try {
      const url = await publishSharedReceiving(r);
      try {
        await navigator.clipboard.writeText(url);
        alert(`Public link copied to clipboard:\n${url}`);
      } catch {
        prompt("Public share link:", url);
      }
    } catch (e) {
      alert(`Could not create share link: ${(e as Error).message}`);
    }
  }

  return (
    <AppShell {...shell}>
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <header className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Store Receiving Item Checklist</h1>
            <p className="text-sm text-muted-foreground">
              Temperature, quantity and quality checks for every incoming delivery.
            </p>
          </div>
        </header>

        {/* New entry form */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            New delivery
          </h2>

          {/* Header fields */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date">
              <input type="date" value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className={inputCls} />
            </Field>
            <Field label="Time">
              <input type="time" value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
                className={inputCls} />
            </Field>
            <Field label="Branch">
              <input type="text" value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value })}
                placeholder="e.g. Main Kitchen" className={inputCls} />
            </Field>
            <Field label="Driver's Name">
              <input type="text" value={form.driver}
                onChange={(e) => setForm({ ...form, driver: e.target.value })}
                placeholder="Driver name" className={inputCls} />
            </Field>
            <Field label="Delivery Note / Invoice #">
              <input type="text" value={form.deliveryNote}
                onChange={(e) => setForm({ ...form, deliveryNote: e.target.value })}
                placeholder="e.g. LM1-1234" className={inputCls} />
            </Field>
            <Field label="Purchase Order #">
              <input type="text" value={form.purchaseOrder}
                onChange={(e) => setForm({ ...form, purchaseOrder: e.target.value })}
                placeholder="Optional" className={inputCls} />
            </Field>
          </div>

          {/* 1. Temperature Check */}
          <EditableChecklistBlock
            title="1. Temperature Check"
            items={template.temp}
            checks={form.tempChecks}
            onToggle={(k) => toggle("tempChecks", k)}
            onAdd={(name) => addTemplateItem("temp", name)}
            onRename={(oldN, newN) => renameTemplateItem("temp", oldN, newN)}
            onRemove={(name) => removeTemplateItem("temp", name)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Chiller Car Temp (°C)  · target 2°C to 5°C">
                <input type="text" value={form.chillerCarTemp}
                  onChange={(e) => setForm({ ...form, chillerCarTemp: e.target.value })}
                  placeholder="e.g. 3" className={inputCls} />
              </Field>
              <Field label="Product Temp (°C)">
                <input type="text" value={form.productTemp}
                  onChange={(e) => setForm({ ...form, productTemp: e.target.value })}
                  placeholder="e.g. 4" className={inputCls} />
              </Field>
            </div>
          </EditableChecklistBlock>

          {/* 2. Quantity Check */}
          <EditableChecklistBlock
            title="2. Quantity Check"
            items={template.quantity}
            checks={form.quantityChecks}
            onToggle={(k) => toggle("quantityChecks", k)}
            onAdd={(name) => addTemplateItem("quantity", name)}
            onRename={(oldN, newN) => renameTemplateItem("quantity", oldN, newN)}
            onRemove={(name) => removeTemplateItem("quantity", name)}
          />

          {/* 3. Quality Check */}
          <EditableChecklistBlock
            title="3. Quality Check"
            items={template.quality}
            checks={form.qualityChecks}
            onToggle={(k) => toggle("qualityChecks", k)}
            onAdd={(name) => addTemplateItem("quality", name)}
            onRename={(oldN, newN) => renameTemplateItem("quality", oldN, newN)}
            onRemove={(name) => removeTemplateItem("quality", name)}
          />


          {/* Receiver / Comments */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Receiver by (Name)">
              <select value={form.receiverName}
                onChange={(e) => setForm({ ...form, receiverName: e.target.value })}
                className={inputCls}>
                <option value="">Select team member…</option>
                {teamMembers.map((s) => (
                  <option key={s} value={s} className="bg-popover text-popover-foreground">{s}</option>
                ))}
                {form.receiverName && !teamMembers.includes(form.receiverName) && (
                  <option value={form.receiverName} className="bg-popover text-foreground">{form.receiverName}</option>
                )}
              </select>
            </Field>
            <Field label="Checked by (team member)">
              <select value={form.checkedBy}
                onChange={(e) => setForm({ ...form, checkedBy: e.target.value })}
                className={inputCls}>
                <option value="">Select team member…</option>
                {teamMembers.map((s) => (
                  <option key={s} value={s} className="bg-popover text-popover-foreground">{s}</option>
                ))}
                {form.checkedBy && !teamMembers.includes(form.checkedBy) && (
                  <option value={form.checkedBy} className="bg-popover text-popover-foreground">{form.checkedBy}</option>
                )}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Comments">
                <input type="text" value={form.comments}
                  onChange={(e) => setForm({ ...form, comments: e.target.value })}
                  placeholder="e.g. Everything is OK" className={inputCls} />
              </Field>
            </div>
          </div>

          {/* Photos */}
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Photos
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
                  <Camera className="h-4 w-4" />
                  Camera
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={(e) => { addPhoto(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
                  <ImageIcon className="h-4 w-4" />
                  Gallery
                  <input type="file" accept="image/*" multiple className="hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      for (const f of files) await addPhoto(f);
                    }} />
                </label>
              </div>
            </div>
            {form.photos.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-background/40 px-3 py-4 text-center text-xs text-muted-foreground">
                No photos attached yet.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {form.photos.map((src, i) => (
                  <div key={i} className="relative aspect-square overflow-hidden rounded-lg border border-border">
                    <img src={src} alt={`Delivery photo ${i + 1}`}
                      className="h-full w-full cursor-zoom-in object-cover"
                      onClick={() => setViewer(src)} />
                    <button onClick={() => removePhoto(i)} aria-label="Remove photo"
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {editingId && (
              <span className="mr-auto rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
                Editing saved delivery
              </span>
            )}
            <button onClick={resetForm}
              className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
              {editingId ? "Cancel edit" : "Clear"}
            </button>
            <button onClick={submit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
              {editingId ? <CheckIcon className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingId ? "Update delivery" : "Save delivery"}
            </button>

          </div>
        </section>

        {/* History */}
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            History ({sorted.length})
          </h2>
          {sorted.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
              No deliveries logged yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {sorted.map((r) => {
                const open = expanded === r.id;
                return (
                  <li key={r.id} className="rounded-2xl border border-border bg-card">
                    <button onClick={() => setExpanded(open ? null : r.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {r.date} · {r.time}{r.branch ? ` · ${r.branch}` : ""}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          Receiver: {r.receiverName || r.checkedBy || "—"}
                          {r.driver ? ` · Driver: ${r.driver}` : ""}
                          {r.deliveryNote ? ` · Note: ${r.deliveryNote}` : ""}
                        </p>
                      </div>
                      {r.photos.length > 0 && (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                          {r.photos.length} 📷
                        </span>
                      )}
                      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>

                    {open && (
                      <div className="space-y-4 border-t border-border px-4 py-3">
                        <dl className="grid gap-2 text-sm sm:grid-cols-2">
                          <Info label="Date / Time" value={`${r.date} ${r.time}`} />
                          <Info label="Branch" value={r.branch} />
                          <Info label="Driver" value={r.driver} />
                          <Info label="Delivery Note / Invoice #" value={r.deliveryNote} />
                          <Info label="Purchase Order #" value={r.purchaseOrder} />
                          <Info label="Chiller Car Temp" value={r.chillerCarTemp ? `${r.chillerCarTemp} °C` : ""} />
                          <Info label="Product Temp" value={r.productTemp ? `${r.productTemp} °C` : ""} />
                          <Info label="Checked by" value={r.checkedBy} />
                          <Info label="Receiver" value={r.receiverName} />
                          <Info label="Signature" value={r.signature} />
                        </dl>

                        <ChecklistView title="1. Temperature Check" items={Object.keys(r.tempChecks || {})} checks={r.tempChecks} />
                        <ChecklistView title="2. Quantity Check" items={Object.keys(r.quantityChecks || {})} checks={r.quantityChecks} />
                        <ChecklistView title="3. Quality Check" items={Object.keys(r.qualityChecks || {})} checks={r.qualityChecks} />

                        {r.comments && (
                          <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">Comments</div>
                            <div className="text-sm text-foreground">{r.comments}</div>
                          </div>
                        )}

                        {r.photos.length > 0 && (
                          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                            {r.photos.map((src, i) => (
                              <button key={i} onClick={() => setViewer(src)}
                                className="aspect-square overflow-hidden rounded-lg border border-border">
                                <img src={src} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="flex flex-wrap justify-end gap-2">
                          <button onClick={() => editRecord(r)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent">
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button onClick={() => shareRecord(r)}

                            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent">
                            <Share2 className="h-3.5 w-3.5" />
                            Copy public link
                          </button>
                          <button onClick={() => deleteRecord(r.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {viewer && (
        <div role="dialog" aria-modal="true" onClick={() => setViewer(null)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
          <img src={viewer} alt="Photo" className="max-h-full max-w-full rounded-lg" />
          <button onClick={(e) => { e.stopPropagation(); setViewer(null); }} aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-black hover:bg-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </AppShell>
  );
}

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
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

function ChecklistBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-background/40 p-3">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function CheckList({
  items, checks, onToggle,
}: { items: string[]; checks: Checks; onToggle: (key: string) => void }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((it) => (
        <li key={it}>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={!!checks[it]}
              onChange={() => onToggle(it)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <span>{it}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function ChecklistView({
  title, items, checks,
}: { title: string; items: string[]; checks: Checks }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="space-y-1 text-sm">
        {items.map((it) => (
          <li key={it} className="flex items-center gap-2">
            <span className={`grid h-4 w-4 place-items-center rounded border ${checks?.[it] ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"}`}>
              {checks?.[it] ? "✓" : ""}
            </span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditableChecklistBlock({
  title, items, checks, onToggle, onAdd, onRename, onRemove, children,
}: {
  title: string;
  items: string[];
  checks: Checks;
  onToggle: (key: string) => void;
  onAdd: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onRemove: (name: string) => void;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  function startEdit(name: string) {
    setEditKey(name);
    setEditVal(name);
  }
  function commitEdit() {
    if (editKey != null) onRename(editKey, editVal);
    setEditKey(null);
    setEditVal("");
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
        >
          {editing ? <><CheckIcon className="h-3 w-3" /> Done</> : <><Pencil className="h-3 w-3" /> Edit</>}
        </button>
      </div>
      {children}
      <ul className="mt-2 space-y-1.5">
        {items.map((it) => (
          <li key={it} className="flex items-center gap-2">
            {editing ? (
              editKey === it ? (
                <>
                  <input
                    autoFocus
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") { setEditKey(null); setEditVal(""); } }}
                    className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-foreground/40"
                  />
                  <button type="button" onClick={commitEdit} className="rounded-md p-1 text-primary hover:bg-accent" aria-label="Save">
                    <CheckIcon className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-foreground">{it}</span>
                  <button type="button" onClick={() => startEdit(it)} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Rename">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => onRemove(it)} className="rounded-md p-1 text-destructive hover:bg-destructive/10" aria-label="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )
            ) : (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={!!checks[it]}
                  onChange={() => onToggle(it)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <span>{it}</span>
              </label>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { onAdd(newItem); setNewItem(""); } }}
            placeholder="New checklist item…"
            className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-foreground/40"
          />
          <button
            type="button"
            onClick={() => { onAdd(newItem); setNewItem(""); }}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
      )}
    </div>
  );
}
