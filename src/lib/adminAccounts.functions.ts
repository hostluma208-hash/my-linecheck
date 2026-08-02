import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Input = { email: string; password: string };

/** Admin-only: set (or create) the password for an allowed account. */
export const adminSetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Input) => {
    const email = String(input?.email ?? "").trim().toLowerCase();
    const password = String(input?.password ?? "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
    if (password.length < 8 || password.length > 72)
      throw new Error("Password must be 8-72 characters");
    return { email, password };
  })
  .handler(async ({ data, context }) => {
    // Caller must be an admin (checked in the database, as the signed-in user).
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("is_admin");
    if (roleErr) throw roleErr;
    if (!isAdmin) throw new Error("Forbidden");

    // Target must already be on the allow-list.
    const { data: allowed, error: allowErr } = await context.supabase
      .from("allowed_emails")
      .select("email")
      .ilike("email", data.email)
      .maybeSingle();
    if (allowErr) throw allowErr;
    if (!allowed) throw new Error("Add this email to the allow-list first.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (!created.error) return { ok: true as const, created: true };

    // Already registered → find the user and update their password.
    let userId: string | null = null;
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) throw error;
      const match = list.users.find(
        (u) => (u.email ?? "").toLowerCase() === data.email,
      );
      if (match) userId = match.id;
      if (list.users.length < 200) break;
    }
    if (!userId) throw new Error(created.error.message);

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: data.password,
      email_confirm: true,
    });
    if (updErr) throw updErr;
    return { ok: true as const, created: false };
  });
