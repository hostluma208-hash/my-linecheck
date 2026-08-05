import { createServerFn } from "@tanstack/react-start";
import type { Creds } from "@/lib/staffAuth.server";

/** Public: exchange a team member's name + PIN for their owner scope. */
export const staffLogin = createServerFn({ method: "POST" })
  .inputValidator((input: Creds) => input)
  .handler(async ({ data }) => {
    const { validCreds, verifyStaff } = await import("@/lib/staffAuth.server");
    const row = await verifyStaff(validCreds(data));
    if (!row) return { ok: false as const };
    return { ok: true as const, id: row.id, name: row.name, ownerId: row.owner_id };
  });

/** Public: read the owner's stored records on behalf of a verified PIN user. */
export const staffPullState = createServerFn({ method: "POST" })
  .inputValidator((input: Creds) => input)
  .handler(async ({ data }) => {
    const { validCreds, verifyStaff } = await import("@/lib/staffAuth.server");
    const row = await verifyStaff(validCreds(data));
    if (!row) return { ok: false as const, state: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("app_records")
      .select("key, value")
      .eq("owner_id", row.owner_id);
    if (error) throw error;
    const state = (rows ?? []).length
      ? Object.fromEntries(
          (rows as { key: string; value: string }[]).map((r) => [r.key, r.value]),
        )
      : null;
    return { ok: true as const, state: state as Record<string, string> | null };
  });

/** Public: write records back into the owner's account. */
export const staffPushState = createServerFn({ method: "POST" })
  .inputValidator((input: Creds & { patch: Record<string, string> }) => input)
  .handler(async ({ data }) => {
    const { validCreds, verifyStaff } = await import("@/lib/staffAuth.server");
    const row = await verifyStaff(validCreds(data));
    if (!row) return { ok: false as const };
    const patch =
      data.patch && typeof data.patch === "object" ? data.patch : {};
    const records = Object.entries(patch)
      .filter(([k, v]) => typeof v === "string" && k.startsWith("linecheck:"))
      .map(([key, value]) => ({
        owner_id: row.owner_id,
        key,
        value,
        updated_at: new Date().toISOString(),
      }));
    if (!records.length) return { ok: true as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_records")
      .upsert(records, { onConflict: "owner_id,key" });
    if (error) throw error;
    return { ok: true as const };
  });

