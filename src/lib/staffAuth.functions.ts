import { createServerFn } from "@tanstack/react-start";
import type { Creds } from "@/lib/staffAuth.server";

/**
 * Public: exchange a team member's name + PIN for a short-lived, revocable
 * session token. The PIN itself is never stored or resent by the browser.
 */
export const staffLogin = createServerFn({ method: "POST" })
  .inputValidator((input: Creds) => input)
  .handler(async ({ data }) => {
    const { validCreds, verifyStaff, issueStaffSession } = await import(
      "@/lib/staffAuth.server"
    );
    const row = await verifyStaff(validCreds(data));
    if (!row) return { ok: false as const };
    const token = await issueStaffSession(row);
    return {
      ok: true as const,
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      token,
    };
  });

/** Public: end a team member session (revokes the token server-side). */
export const staffLogout = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const { validToken, revokeStaffToken } = await import("@/lib/staffAuth.server");
    await revokeStaffToken(validToken(data));
    return { ok: true as const };
  });

type StaffPullInput = {
  token: string;
  from?: number;
  limit?: number;
  priorityOnly?: boolean;
};

/** Read one ordered page of the owner's records for a PIN user. */
export const staffPullState = createServerFn({ method: "POST" })
  .inputValidator((input: StaffPullInput) => input)
  .handler(async ({ data }) => {
    const { validToken, verifyStaffToken } = await import("@/lib/staffAuth.server");
    const row = await verifyStaffToken(validToken(data));
    if (!row) return { ok: false as const, rows: [] };
    const from = Math.max(0, Math.floor(Number(data.from) || 0));
    const limit = Math.min(250, Math.max(1, Math.floor(Number(data.limit) || 250)));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("app_records")
      .select("key, value, updated_at")
      .eq("owner_id", row.owner_id);
    if (data.priorityOnly) {
      query = query.or(
        "key.like.linecheck:settings:%,key.like.linecheck:order:%,key.like.linecheck:theme%,key.eq.linecheck:closing-template,key.like.linecheck:section-items:%",
      );
    }
    const { data: rows, error } = await query
      .order("key", { ascending: true })
      .range(from, from + limit - 1);
    if (error) throw error;
    return {
      ok: true as const,
      rows: (rows ?? []) as { key: string; value: string; updated_at: string }[],
    };
  });

/** Write records back into the owner's account for a token-authenticated user. */
export const staffPushState = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; patch: Record<string, string> }) => input)
  .handler(async ({ data }) => {
    const { validToken, verifyStaffToken } = await import("@/lib/staffAuth.server");
    const row = await verifyStaffToken(validToken(data));
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
