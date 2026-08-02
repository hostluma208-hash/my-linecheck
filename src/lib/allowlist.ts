import { supabase } from "@/integrations/supabase/client";

export const ADMIN_EMAILS = ["iamjiroyano@gmail.com", "hajime015@gmail.com"];
export const ADMIN_EMAIL = ADMIN_EMAILS[0];

const CACHE_KEY = "linecheck:allowlist:ok";

export function isAdminEmail(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.includes((email || "").trim().toLowerCase());
}

function rememberAllowed(email: string, ok: boolean) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ email, ok }));
  } catch {}
}

function recallAllowed(email: string): boolean | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && v.email === email) return !!v.ok;
  } catch {}
  return null;
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Returns true if the given email is on the allowed_emails list (or is the admin). */
export async function isEmailAllowed(email: string | null | undefined): Promise<boolean> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return false;
  if (isAdminEmail(e)) return true;

  // Offline: trust the last known verdict so the app keeps working.
  if (isOffline()) {
    const cached = recallAllowed(e);
    if (cached !== null) return cached;
  }

  const { data, error } = await supabase
    .from("allowed_emails")
    .select("email")
    .ilike("email", e)
    .maybeSingle();
  if (error) {
    console.warn("[allowlist] check failed", error);
    // Network failure — fall back to the cached verdict instead of locking out.
    const cached = recallAllowed(e);
    if (cached !== null) return cached;
    return false;
  }
  const ok = !!data;
  rememberAllowed(e, ok);
  return ok;
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
