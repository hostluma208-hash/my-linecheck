import { supabase } from "@/integrations/supabase/client";

export const ADMIN_EMAILS = ["iamjiroyano@gmail.com", "hajime015@gmail.com"];
export const ADMIN_EMAIL = ADMIN_EMAILS[0];

export function isAdminEmail(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.includes((email || "").trim().toLowerCase());
}

/** Returns true if the given email is on the allowed_emails list (or is the admin). */
export async function isEmailAllowed(email: string | null | undefined): Promise<boolean> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return false;
  if (isAdminEmail(e)) return true;
  const { data, error } = await supabase
    .from("allowed_emails")
    .select("email")
    .ilike("email", e)
    .maybeSingle();
  if (error) {
    console.warn("[allowlist] check failed", error);
    return false;
  }
  return !!data;
}

/**
 * Enforces the allowlist for the current session. If the signed-in user's
 * email is not permitted, signs them out and returns a reason string.
 * Returns null when the user is allowed (or when no session exists).
 */
export async function enforceAllowlist(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const email = user.email || "";
  const ok = await isEmailAllowed(email);
  if (ok) return null;
  await supabase.auth.signOut();
  return `Access denied for ${email}. Ask the admin to add your email.`;
}
