import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useShellState } from "@/components/AppShell";
import { lsStore } from "@/lib/lsStore";
import { savePhoto } from "@/lib/photoStore";
import { STAFF, getEffectiveSections } from "@/lib/lineCheck";
import {
  Camera,
  Check as CheckIcon,
  ClipboardCheck,
  Download,
  Image as ImageIcon,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";


import { downloadClosingSnapshot } from "@/lib/closingSnapshot";

export const Route = createFileRoute("/closing")({
  head: () => ({
    meta: [
      { title: "Closing Report — Line Check 2026" },
      {
        name: "description",
        content:
          "End-of-day closing checklist: verify every task before leaving the restaurant, attach photos, and share a read-only report link.",
      },
      { property: "og:title", content: "Closing Report — Line Check 2026" },
      {
        property: "og:description",
        content: "End-of-day closing checklist with photos and shareable read-only reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClosingPage,
});

const LS_KEY = "linecheck:closing";
const TEMPLATE_KEY = "linecheck:closing-template";

const DEFAULT_ITEMS = [
  "All equipment switched off",
  "Gas and main valves closed",
  "Fridges and chillers closed and at temperature",
  "All food covered, labelled and dated",
  "Floors swept and mopped",
  "Bins emptied and liners replaced",
  "Sinks and work surfaces sanitised",
  "Lights off and doors locked",
];

function loadTemplate(): string[] {
  try {
    const raw = lsStore.getItem(TEMPLATE_KEY);
    if (raw) {
      const t = JSON.parse(raw);
      if (Array.isArray(t) && t.every((x) => typeof x === "string")) return t;
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_ITEMS];
}
function saveTemplate(t: string[]) {
  lsStore.setItem(TEMPLATE_KEY, JSON.stringify(t));
}

type Checks = Record<string, boolean>;

export type CrewEntry = { member: string; stations: string[] };

type ClosingRecord = {
  id: string;
  createdAt: string;
  date: string;
  time: string;
  branch: string;
  closedBy: string;
  crew: CrewEntry[];
  checks: Checks;
  notes: string;
  photos: string[];
};

function loadRecords(): ClosingRecord[] {
  try {
    const raw = lsStore.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveRecords(list: ClosingRecord[]) {
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

// The in-progress report is kept on the device so a refresh never loses it.
// It is only removed when the user taps Clear.
const DRAFT_KEY = "linecheck:closing-draft";

type ClosingForm = {
  date: string;
  time: string;
  branch: string;
  closedBy: string;
  crew: CrewEntry[];
  checks: Checks;
  notes: string;
  photos: string[];
};

function loadDraft(): { form: ClosingForm; editingId: string | null } | null {
  try {
    const raw = lsStore.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object" || !d.form) return null;
    const f = d.form;
    return {
      form: {
        date: String(f.date ?? ""),
        time: String(f.time ?? ""),
        branch: String(f.branch ?? ""),
        closedBy: String(f.closedBy ?? ""),
        crew: Array.isArray(f.crew) ? f.crew : [],
        checks: f.checks && typeof f.checks === "object" ? f.checks : {},
        notes: String(f.notes ?? ""),
        photos: Array.isArray(f.photos) ? f.photos : [],
      },
      editingId: typeof d.editingId === "string" ? d.editingId : null,
    };
  } catch {
    return null;
  }
}


function ClosingPage() {
  const shell = useShellState("Closing Report");
  const [records, setRecords] = useState<ClosingRecord[]>(() => loadRecords());
  const [template, setTemplate] = useState<string[]>(() => loadTemplate());
  // Manager / team list managed in Settings → Manager tab
  const [members, setMembers] = useState<string[]>(STAFF);
  useEffect(() => {
    const read = () => {
      try {
        const raw = lsStore.getItem("linecheck:settings:staff");
        const parsed = raw ? JSON.parse(raw) : null;
        setMembers(Array.isArray(parsed) && parsed.length ? parsed : STAFF);
      } catch {
        setMembers(STAFF);
      }
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener("focus", read);
    };
  }, []);

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

  const [form, setForm] = useState<ClosingForm>(() => {
    const { date, time } = nowParts();
    return {
      date,
      time,
      branch: "",
      closedBy: "",
      crew: [] as CrewEntry[],
      checks: emptyChecks(loadTemplate()),
      notes: "",
      photos: [] as string[],
    };
  });
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newItem, setNewItem] = useState("");
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [viewer, setViewer] = useState<string | null>(null);
  // Draft restore runs after hydration so the server and client markup match.
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setForm(draft.form);
      setEditingId(draft.editingId);
    }
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      lsStore.setItem(DRAFT_KEY, JSON.stringify({ form, editingId }), { quiet: true });
    } catch {}
  }, [form, editingId, draftLoaded]);




  useEffect(() => {
    const refresh = () => {
      setRecords(loadRecords());
      setTemplate(loadTemplate());
    };
    window.addEventListener("linecheck:update", refresh);
    window.addEventListener("linecheck:scope-change", refresh);
    return () => {
      window.removeEventListener("linecheck:update", refresh);
      window.removeEventListener("linecheck:scope-change", refresh);
    };
  }, []);

  function updateTemplate(updater: (arr: string[]) => string[]) {
    setTemplate((prev) => {
      const next = updater(prev);
      saveTemplate(next);
      setForm((f) => {
        const rebuilt: Checks = {};
        next.forEach((it) => {
          rebuilt[it] = !!f.checks[it];
        });
        return { ...f, checks: rebuilt };
      });
      return next;
    });
  }
  function addItem() {
    const clean = newItem.trim();
    if (!clean) return;
    updateTemplate((arr) => (arr.includes(clean) ? arr : [...arr, clean]));
    setNewItem("");
  }
  function startEdit(name: string) {
    setEditKey(name);
    setEditVal(name);
  }
  function commitEdit() {
    if (editKey != null) {
      const clean = editVal.trim();
      if (clean && clean !== editKey) {
        const old = editKey;
        updateTemplate((arr) => arr.map((x) => (x === old ? clean : x)));
      }
    }
    setEditKey(null);
    setEditVal("");
  }
  function removeItem(name: string) {
    updateTemplate((arr) => arr.filter((x) => x !== name));
  }

  const stationNames = useMemo(() => getEffectiveSections().map((s) => s.name), [records]);

  function addCrew(member: string) {
    setForm((f) =>
      f.crew.some((c) => c.member === member)
        ? f
        : { ...f, crew: [...f.crew, { member, stations: [] }] },
    );
  }
  function removeCrew(member: string) {
    setForm((f) => ({ ...f, crew: f.crew.filter((c) => c.member !== member) }));
  }
  function toggleCrewStation(member: string, station: string) {
    setForm((f) => ({
      ...f,
      crew: f.crew.map((c) =>
        c.member === member
          ? {
              ...c,
              stations: c.stations.includes(station)
                ? c.stations.filter((s) => s !== station)
                : [...c.stations, station],
            }
          : c,
      ),
    }));
  }

  const doneCount = template.filter((i) => form.checks[i]).length;


  async function addPhoto(file: File | null | undefined) {
    if (!file) return;
    try {
      const dataUrl = await savePhoto(file);
      setForm((f) => ({ ...f, photos: [...f.photos, dataUrl] }));
    } catch (e) {
      console.warn("photo failed", e);
    }
  }
  function removePhoto(idx: number) {
    setForm((f) => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }));
  }
  function toggle(key: string) {
    setForm((f) => ({ ...f, checks: { ...f.checks, [key]: !f.checks[key] } }));
  }

  function resetForm() {
    const { date, time } = nowParts();
    setForm({
      date,
      time,
      branch: "",
      closedBy: "",
      crew: [],
      checks: emptyChecks(template),
      notes: "",
      photos: [],
    });
    lsStore.removeItem(DRAFT_KEY);
  }



  return (

    <AppShell {...shell}>
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <header className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Closing Report</h1>
            <p className="text-sm text-muted-foreground">
              Everything that must be checked before leaving the restaurant.
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            New closing report
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date">
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Time">
              <input
                type="time"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Branch">
              <input
                type="text"
                value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value })}
                placeholder="e.g. Main Kitchen"
                className={inputCls}
              />
            </Field>
            <Field label="REPORTED BY">
              <select
                value={members.includes(form.closedBy) ? form.closedBy : ""}
                onChange={(e) => setForm({ ...form, closedBy: e.target.value })}
                className={inputCls}
              >
                <option value="">Select manager…</option>
                {members.map((m) => (
                  <option key={m} value={m} className="bg-popover text-popover-foreground">
                    {m}
                  </option>
                ))}
              </select>
            </Field>

          </div>

          {/* Closing team */}
          <div className="mt-4 rounded-xl border border-border bg-background/40 p-3">
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              Closing team{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({form.crew.length} selected)
              </span>
            </h3>

            <select
              value=""
              onChange={(e) => {
                const m = e.target.value;
                if (m) addCrew(m);
              }}
              className={inputCls}
            >
              <option value="">Add team member…</option>
              {teamMembers.filter((s) => !form.crew.some((c) => c.member === s)).map((s) => (
                <option key={s} value={s} className="bg-popover text-popover-foreground">
                  {s}
                </option>
              ))}
            </select>
            {teamMembers.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                No team members yet — add them in Settings → Team Members.
              </p>
            )}

            {form.crew.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Add the members who closed and tick the stations each of them closed.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {form.crew.map((c) => (
                  <li key={c.member} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{c.member}</span>
                      <button
                        type="button"
                        onClick={() => removeCrew(c.member)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={`Remove ${c.member}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {stationNames.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No stations yet.</span>
                      ) : (
                        stationNames.map((st) => {
                          const on = c.stations.includes(st);
                          return (
                            <button
                              key={st}
                              type="button"
                              onClick={() => toggleCrewStation(c.member, st)}
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                                on
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-input bg-background text-foreground hover:bg-accent"
                              }`}
                            >
                              {st}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Checklist */}
          <div className="mt-4 rounded-xl border border-border bg-background/40 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Closing checklist{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({doneCount}/{template.length})
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
              >
                {editing ? (
                  <>
                    <CheckIcon className="h-3 w-3" /> Done
                  </>
                ) : (
                  <>
                    <Pencil className="h-3 w-3" /> Edit
                  </>
                )}
              </button>
            </div>

            {template.length === 0 && (
              <p className="py-2 text-xs text-muted-foreground">
                No checklist items yet — tap Edit to add some.
              </p>
            )}

            <ul className="mt-2 space-y-1.5">
              {template.map((it) => (
                <li key={it} className="flex items-center gap-2">
                  {editing ? (
                    editKey === it ? (
                      <>
                        <input
                          autoFocus
                          value={editVal}
                          onChange={(e) => setEditVal(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") {
                              setEditKey(null);
                              setEditVal("");
                            }
                          }}
                          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-foreground/40"
                        />
                        <button
                          type="button"
                          onClick={commitEdit}
                          className="rounded-md p-1 text-primary hover:bg-accent"
                          aria-label="Save item"
                        >
                          <CheckIcon className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 text-sm text-foreground">{it}</span>
                        <button
                          type="button"
                          onClick={() => startEdit(it)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                          aria-label={`Rename ${it}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(it)}
                          className="rounded-md p-1 text-destructive hover:bg-destructive/10"
                          aria-label={`Delete ${it}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )
                  ) : (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={!!form.checks[it]}
                        onChange={() => toggle(it)}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      <span>{it}</span>
                    </label>
                  )}
                </li>
              ))}
            </ul>

            {editing && (
              <div className="mt-3 flex gap-2">
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addItem();
                  }}
                  placeholder="Add a check…"
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-foreground/40"
                />
                <button
                  type="button"
                  onClick={addItem}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
            )}
          </div>

          <div className="mt-4">
            <Field label="Notes">
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                placeholder="Anything the next shift should know…"
                className={inputCls}
              />
            </Field>
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
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      addPhoto(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">
                  <ImageIcon className="h-4 w-4" />
                  Gallery
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      for (const f of files) await addPhoto(f);
                    }}
                  />
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
                  <div
                    key={i}
                    className="relative aspect-square overflow-hidden rounded-lg border border-border"
                  >
                    <img
                      src={src}
                      alt={`Closing photo ${i + 1}`}
                      className="h-full w-full cursor-zoom-in object-cover"
                      onClick={() => setViewer(src)}
                    />
                    <button
                      onClick={() => removePhoto(i)}
                      aria-label="Remove photo"
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() =>
                downloadClosingSnapshot({
                  id: "current",
                  date: form.date,
                  time: form.time,
                  branch: form.branch.trim(),
                  closedBy:
                    form.closedBy.trim() ||
                    form.crew.filter((c) => c.member.trim()).map((c) => c.member).join(", "),
                  crew: form.crew.filter((c) => c.member.trim()),
                  checks: form.checks,
                  notes: form.notes.trim(),
                  photos: form.photos,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              <Download className="h-4 w-4" />
              Download PNG
            </button>
            <button
              onClick={resetForm}
              className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Clear
            </button>
          </div>

        </section>

      </div>

      {viewer && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setViewer(null)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
        >
          <img src={viewer} alt="Photo" className="max-h-full max-w-full rounded-lg" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setViewer(null);
            }}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-black hover:bg-white"
          >
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
