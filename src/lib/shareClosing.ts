import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lsStore } from "@/lib/lsStore";
import { optimizePayload, getCachedShareUrl, setCachedShareUrl } from "@/lib/shareOptimize";
import { getStaffSession } from "@/lib/staffSession";
import { staffPublishShare } from "@/lib/staffShare.functions";


const checksSchema = z.record(z.string(), z.boolean()).catch({});

export const sharedClosingPayloadSchema = z.object({
  id: z.string(),
  createdAt: z.string().catch(""),
  date: z.string().catch(""),
  time: z.string().catch(""),
  branch: z.string().catch(""),
  closedBy: z.string().catch(""),
  crew: z
    .array(
      z.object({
        member: z.string().catch(""),
        stations: z.array(z.string()).catch([]),
      }),
    )
    .catch([]),
  checks: checksSchema,
  notes: z.string().catch(""),
  photos: z.array(z.string()).catch([]),
  brand_name: z.string().catch("LUMA"),
});

export type SharedClosingPayload = z.infer<typeof sharedClosingPayloadSchema>;

export async function publishSharedClosing(
  record: Record<string, unknown> & { id: string },
): Promise<string> {
  const brand_name = lsStore.getItem("linecheck:settings:brand:name") || "LUMA";
  const payload = await optimizePayload({ ...record, brand_name });
  const cached = getCachedShareUrl("closing", record.id, payload);
  if (cached) return cached;

  const staff = getStaffSession();
  if (staff) {
    const { id } = await staffPublishShare({
      data: {
        name: staff.name,
        pin: staff.pin,
        kind: "closing",
        record_id: record.id,
        brand_name,
        payload: JSON.parse(JSON.stringify(payload)),
      },
    });
    const url = `${window.location.origin}/c/${id}`;
    setCachedShareUrl("closing", record.id, payload, url);
    return url;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const owner_id = sessionData.session?.user?.id;
  if (!owner_id) throw new Error("Sign in required to share");


  const { data, error } = await supabase
    .from("shared_closings")
    .upsert(
      {
        owner_id,
        record_id: record.id,
        brand_name,
        payload: JSON.parse(JSON.stringify(payload)),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,record_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to publish share");
  const url = `${window.location.origin}/c/${data.id}`;
  setCachedShareUrl("closing", record.id, payload, url);
  return url;
}
