import { createHash, randomBytes } from "node:crypto";

export type Creds = { name: string; pin: string };
/** Session token issued after a successful PIN check. */
export type StaffToken = { token: string };

export function hashPin(name: string, pin: string) {
  return createHash("sha256")
    .update(`linecheck:${name.trim().toLowerCase()}:${pin.trim()}`, "utf8")
    .digest("hex");
}

export function hashToken(token: string) {
  return createHash("sha256").update(`linecheck:session:${token}`, "utf8").digest("hex");
}

export function validCreds(input: Creds): Creds {
  const name = String(input?.name ?? "").trim();
  const pin = String(input?.pin ?? "").trim();
  if (!name || name.length > 60) throw new Error("Invalid name");
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4-8 digits");
  return { name, pin };
}

export function validToken(input: { token?: unknown }): string {
  const token = String(input?.token ?? "").trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) throw new Error("Invalid session");
  return token;
}

export async function verifyStaff(creds: Creds) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("staff_logins")
    .select("id, owner_id, name, pin_hash")
    .ilike("name", creds.name)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.pin_hash !== hashPin(creds.name, creds.pin)) return null;
  return data;
}

const SESSION_DAYS = 30;

/** Create a short-lived, revocable session for a verified team member. */
export async function issueStaffSession(staff: { id: string; owner_id: string }) {
  const token = randomBytes(32).toString("base64url");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("staff_sessions").insert({
    staff_id: staff.id,
    owner_id: staff.owner_id,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString(),
  });
  if (error) throw error;
  return token;
}

/** Resolve a session token to its team member, or null when invalid/expired. */
export async function verifyStaffToken(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("staff_sessions")
    .select("id, staff_id, owner_id, expires_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await supabaseAdmin.from("staff_sessions").delete().eq("id", data.id);
    return null;
  }
  const { data: staff, error: staffErr } = await supabaseAdmin
    .from("staff_logins")
    .select("id, owner_id, name")
    .eq("id", data.staff_id)
    .maybeSingle();
  if (staffErr) throw staffErr;
  if (!staff) return null;
  void supabaseAdmin
    .from("staff_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  return staff;
}

export async function revokeStaffToken(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("staff_sessions").delete().eq("token_hash", hashToken(token));
}
