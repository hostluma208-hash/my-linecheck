import { createHash } from "node:crypto";

export type Creds = { name: string; pin: string };

export function hashPin(name: string, pin: string) {
  return createHash("sha256")
    .update(`linecheck:${name.trim().toLowerCase()}:${pin.trim()}`, "utf8")
    .digest("hex");
}

export function validCreds(input: Creds): Creds {
  const name = String(input?.name ?? "").trim();
  const pin = String(input?.pin ?? "").trim();
  if (!name || name.length > 60) throw new Error("Invalid name");
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4-8 digits");
  return { name, pin };
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
