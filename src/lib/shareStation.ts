import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  effectiveCategorizedItems,
  getShifts,
  loadMember,
  loadSection,
  isFlaggedStatus,
  readEntry,
  type Slot,
} from "@/lib/lineCheck";
import { lsStore } from "@/lib/lsStore";
import { optimizePayload, getCachedShareUrl, setCachedShareUrl } from "@/lib/shareOptimize";

const PUBLIC_APP_ORIGIN = "https://my-linecheck.lovable.app";

function publicShareUrl(url: string): string {
  const parsed = new URL(url, PUBLIC_APP_ORIGIN);
  return `${PUBLIC_APP_ORIGIN}${parsed.pathname}${parsed.search}`;
}

const itemSchema = z.object({
  name: z.string().catch(""),
  status: z.string().catch(""),
  note: z.string().catch(""),
  photo: z.string().optional(),
  flagged: z.boolean().catch(false),
});

const categorySchema = z.object({
  group: z.string().catch(""),
  items: z.array(itemSchema).catch([]),
});

const shiftSchema = z.object({
  id: z.string().catch(""),
  label: z.string().catch(""),
  member: z.string().catch(""),
  categories: z.array(categorySchema).catch([]),
  temps: z.record(z.string(), z.string()).catch({}),
  comment: z.string().catch(""),
  commentPhotos: z.array(z.string()).catch([]),
  totalItems: z.number().int().nonnegative().catch(0),
  checkedItems: z.number().int().nonnegative().catch(0),
  flagged: z.number().int().nonnegative().catch(0),
});

export const sharedStationPayloadSchema = z.object({
  station: z.string().catch(""),
  date: z.string().catch(""),
  brand_name: z.string().catch("LUMA"),
  tempUnit: z.enum(["F", "C"]).catch("F"),
  shifts: z.array(shiftSchema).catch([]),
});

export type SharedStationPayload = z.infer<typeof sharedStationPayloadSchema>;

function buildPayload(station: string, date: string): SharedStationPayload {
  const tempUnit =
    (lsStore.getItem("linecheck:settings:temp-unit") as "F" | "C" | null) || "F";
  const brand_name = lsStore.getItem("linecheck:settings:brand:name") || "LUMA";
  const state = loadSection(station, date);
  const cats = effectiveCategorizedItems(station);

  const shifts = getShifts().map((s) => {
    const slot: Slot = s.id;
    let totalItems = 0;
    let checkedItems = 0;
    let flagged = 0;

    const categories = cats.map((c) => {
      const counts = new Map<string, number>();
      const items = c.items.map((it) => {
        const occ = counts.get(it.name) ?? 0;
        counts.set(it.name, occ + 1);
        const e = readEntry(state, c.group, it.name, slot, occ);
        const status = e?.status || "";
        totalItems += 1;
        if (status) checkedItems += 1;
        const isFlagged = !!status && isFlaggedStatus(status);
        if (isFlagged) flagged += 1;
        return {
          name: it.name,
          status,
          note: e?.note || "",
          photo: e?.photo,
          flagged: isFlagged,
        };
      });
      return { group: c.group, items };
    });

    let temps: Record<string, string> = {};
    try {
      const raw = lsStore.getItem(`linecheck:temps:${station}:${date}:${slot}`);
      if (raw) temps = JSON.parse(raw) ?? {};
    } catch {}

    const comment =
      lsStore.getItem(`linecheck:section-comment:${station}:${date}:${slot}`) || "";
    let commentPhotos: string[] = [];
    try {
      const raw = lsStore.getItem(
        `linecheck:section-comment-photos:${station}:${date}:${slot}`,
      );
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
          commentPhotos = parsed.filter((x) => typeof x === "string");
      }
    } catch {}

    return {
      id: slot,
      label: s.label,
      member: loadMember(date, slot),
      categories,
      temps,
      comment,
      commentPhotos,
      totalItems,
      checkedItems,
      flagged,
    };
  });

  return { station, date, brand_name, tempUnit: tempUnit === "C" ? "C" : "F", shifts };
}

/**
 * Public URL of the station-picker page listing every station this account
 * has shared. Works for manager accounts and PIN staff sessions.
 */
export async function getStationsHubUrl(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  let owner_id = sessionData.session?.user?.id;
  if (!owner_id) {
    const { getStaffSession } = await import("@/lib/staffSession");
    owner_id = getStaffSession()?.ownerId;
  }
  if (!owner_id) throw new Error("Sign in required to share");
  return `${PUBLIC_APP_ORIGIN}/st?owner=${owner_id}`;
}

/**
 * Publish a station's whole-day dashboard (every shift) and return a public URL.
 * Upserts on (owner_id, date, station) so re-sharing keeps the same link.
 */
export async function publishSharedStation(
  station: string,
  date: string,
): Promise<string> {
  const payload = await optimizePayload(buildPayload(station, date));
  const cached = getCachedShareUrl("station", `${date}:${station}`, payload);
  if (cached) return publicShareUrl(cached);

  const { data: sessionData } = await supabase.auth.getSession();
  const owner_id = sessionData.session?.user?.id;
  if (!owner_id) throw new Error("Sign in required to share");

  const { data, error } = await supabase
    .from("shared_stations")
    .upsert(
      {
        owner_id,
        date,
        station,
        brand_name: payload.brand_name,
        payload: JSON.parse(JSON.stringify(payload)),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,date,station" },
    )
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to publish share");

  const url = `${PUBLIC_APP_ORIGIN}/st/${data.id}`;
  setCachedShareUrl("station", `${date}:${station}`, payload, url);
  return url;
}

/**
 * Publish every station's board, then return the public station-picker URL.
 * Individual station failures are skipped so one bad station can't block the rest.
 */
export async function publishStationsHub(date: string): Promise<string> {
  const { getEffectiveSections } = await import("@/lib/lineCheck");
  for (const s of getEffectiveSections()) {
    try {
      await publishSharedStation(s.name, date);
    } catch {
      // skip stations that fail to publish
    }
  }
  return getStationsHubUrl();
}

