import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  effectiveCategorizedItems,
  getEffectiveSections,
  loadSection,
  loadMember,
  shiftHistory,
  type Slot,
} from "@/lib/lineCheck";
import { lsStore } from "@/lib/lsStore";
import { optimizePayload, getCachedShareUrl, setCachedShareUrl } from "@/lib/shareOptimize";

const slotSchema = z.string();

const entrySchema = z.object({
  status: z.string().catch(""),
  note: z.string().catch(""),
  photo: z.string().optional(),
});

const sectionStateSchema = z.object({
  date: z.string().catch(""),
  opening: z.string().catch(""),
  mid: z.string().catch(""),
  closing: z.string().catch(""),
  entries: z.record(z.string(), z.record(z.string(), entrySchema)).catch({}),
});

const categorySchema = z.object({
  group: z.string().catch(""),
  items: z.array(z.object({ name: z.string() })).catch([]),
});

const summarySchema = z.object({
  date: z.string().catch(""),
  slot: slotSchema,
  member: z.string().catch(""),
  stationsTouched: z.number().int().nonnegative().catch(0),
  stationsComplete: z.number().int().nonnegative().catch(0),
  totalItems: z.number().int().nonnegative().catch(0),
  checkedItems: z.number().int().nonnegative().catch(0),
  flagged: z.number().int().nonnegative().catch(0),
});

export const sharedShiftPayloadSchema = z.object({
  date: z.string().catch(""),
  shift: slotSchema,
  member: z.string().catch(""),
  brand_name: z.string().catch("LUMA"),
  summary: summarySchema,
  sections: z
    .array(
      z.object({
        name: z.string(),
        state: sectionStateSchema,
        categories: z.array(categorySchema).catch([]),
        temps: z.record(z.string(), z.string()).catch({}),
        tempUnit: z.enum(["F", "C"]).catch("F"),
        comment: z.string().catch(""),
        commentPhotos: z.array(z.string()).catch([]),
      }),
    )
    .catch([]),
});


export type SharedShiftPayload = z.infer<typeof sharedShiftPayloadSchema>;

function buildPayload(date: string, slot: Slot): SharedShiftPayload {
  const tempUnit =
    (lsStore.getItem("linecheck:settings:temp-unit") as "F" | "C" | null) || "F";
  const sections = getEffectiveSections().map((s) => {
    let temps: Record<string, string> = {};
    try {
      const raw = lsStore.getItem(`linecheck:temps:${s.name}:${date}:${slot}`);
      if (raw) temps = JSON.parse(raw) ?? {};
    } catch {}
    const comment =
      lsStore.getItem(`linecheck:section-comment:${s.name}:${date}:${slot}`) || "";
    let commentPhotos: string[] = [];
    try {
      const raw = lsStore.getItem(
        `linecheck:section-comment-photos:${s.name}:${date}:${slot}`,
      );
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) commentPhotos = parsed.filter((x) => typeof x === "string");
      }
    } catch {}
    return {
      name: s.name,
      state: loadSection(s.name, date),
      categories: effectiveCategorizedItems(s.name),
      temps,
      tempUnit: (tempUnit === "C" ? "C" : "F") as "F" | "C",
      comment,
      commentPhotos,
    };
  });

  const brand_name = lsStore.getItem("linecheck:settings:brand:name") || "LUMA";
  return {
    date,
    shift: slot,
    member: loadMember(date, slot),
    brand_name,
    summary: shiftHistory(date, slot),
    sections,
  };
}

/**
 * Publish the current shift snapshot to the database and return a public URL.
 * Uses upsert on (owner_id, date, shift) so re-sharing keeps the same link.
 */
export async function publishSharedShift(date: string, slot: Slot): Promise<string> {
  const payload = await optimizePayload(buildPayload(date, slot));
  const cached = getCachedShareUrl("shift", `${date}:${slot}`, payload);
  if (cached) return cached;

  // getSession() reads the cached session locally; getUser() would add a network round-trip.
  const { data: sessionData } = await supabase.auth.getSession();
  const owner_id = sessionData.session?.user?.id;
  if (!owner_id) throw new Error("Sign in required to share");

  const { data, error } = await supabase
    .from("shared_shifts")
    .upsert(
      {
        owner_id,
        date,
        shift: slot,
        member: payload.member || null,
        brand_name: payload.brand_name,
        payload: JSON.parse(JSON.stringify(payload)),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,date,shift" },
    )
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to publish share");
  setCachedShareUrl("shift", `${date}:${slot}`, payload, `${window.location.origin}/s/${data.id}`);
  return `${window.location.origin}/s/${data.id}`;
}
