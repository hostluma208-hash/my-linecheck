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

/** Public: read the owner's synced app state on behalf of a verified PIN user. */
export const staffPullState = createServerFn({ method: "POST" })
  .inputValidator((input: Creds) => input)
  .handler(async ({ data }) => {
    const { validCreds, verifyStaff } = await import("@/lib/staffAuth.server");
    const row = await verifyStaff(validCreds(data));
    if (!row) return { ok: false as const, state: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: state, error } = await supabaseAdmin
      .from("user_state")
      .select("data")
      .eq("user_id", row.owner_id)
      .maybeSingle();
    if (error) throw error;
    return {
      ok: true as const,
      state: (state?.data ?? null) as Record<string, string> | null,
    };
  });

/** Public: merge keys back into the owner's synced app state. */
export const staffPushState = createServerFn({ method: "POST" })
  .inputValidator((input: Creds & { patch: Record<string, string> }) => input)
  .handler(async ({ data }) => {
    const { validCreds, verifyStaff } = await import("@/lib/staffAuth.server");
    const row = await verifyStaff(validCreds(data));
    if (!row) return { ok: false as const };
    const patch =
      data.patch && typeof data.patch === "object" ? data.patch : {};
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: state } = await supabaseAdmin
      .from("user_state")
      .select("data")
      .eq("user_id", row.owner_id)
      .maybeSingle();
    const merged = { ...((state?.data ?? {}) as Record<string, string>) };
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v === "string" && k.startsWith("linecheck:")) merged[k] = v;
    }
    const { error } = await supabaseAdmin.from("user_state").upsert(
      { user_id: row.owner_id, data: merged, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    if (error) throw error;
    return { ok: true as const };
  });
