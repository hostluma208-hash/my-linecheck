import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AccountPinCreds } from "@/lib/accountPin.server";

/** Admin-only: set (or clear) the login PIN of an allow-listed account. */
export const setAccountPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string; pin: string | null }) => {
    const email = String(input?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
    const pin = input?.pin == null ? null : String(input.pin).trim();
    if (pin !== null && !/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4-8 digits");
    return { email, pin };
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("is_admin");
    if (roleErr) throw roleErr;
    if (!isAdmin) throw new Error("Forbidden");

    const { data: allowed, error: allowErr } = await context.supabase
      .from("allowed_emails")
      .select("email")
      .ilike("email", data.email)
      .maybeSingle();
    if (allowErr) throw allowErr;
    if (!allowed) throw new Error("Add this email to the allow-list first.");

    const { hashAccountPin } = await import("@/lib/accountPin.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("allowed_emails")
      .update({ pin_hash: data.pin ? hashAccountPin(allowed.email, data.pin) : null })
      .eq("email", allowed.email);
    if (error) throw error;
    return { ok: true as const, hasPin: !!data.pin };
  });

/**
 * Public: exchange an account email + PIN for a one-time token the browser can
 * turn into a real signed-in session.
 */
export const accountPinLogin = createServerFn({ method: "POST" })
  .inputValidator((input: AccountPinCreds) => input)
  .handler(async ({ data }) => {
    const { validAccountPin, hashAccountPin } = await import("@/lib/accountPin.server");
    const creds = validAccountPin(data);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("allowed_emails")
      .select("email, pin_hash")
      .ilike("email", creds.email)
      .maybeSingle();
    if (error) throw error;
    if (!row?.pin_hash) return { ok: false as const };
    if (row.pin_hash !== hashAccountPin(row.email, creds.pin)) return { ok: false as const };

    const makeLink = async () =>
      supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email: row.email });

    let link = await makeLink();
    if (link.error) {
      // No auth user yet — create one with a random password, then retry.
      const created = await supabaseAdmin.auth.admin.createUser({
        email: row.email,
        password: crypto.randomUUID() + crypto.randomUUID(),
        email_confirm: true,
      });
      if (created.error) throw created.error;
      link = await makeLink();
      if (link.error) throw link.error;
    }

    const tokenHash = link.data.properties?.hashed_token;
    if (!tokenHash) throw new Error("Could not start session");
    return { ok: true as const, email: row.email, tokenHash };
  });
