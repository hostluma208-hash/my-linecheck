// Simple "name + PIN" team-member session, stored in this browser only.
// PIN users get read/write access to Receiving and Closing reports of the
// account (owner) that created their PIN login.

export type StaffSession = {
  id: string;
  name: string;
  ownerId: string;
  pin: string;
};

const KEY = "linecheck:staff-session";

export function getStaffSession(): StaffSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.id && s.name && s.ownerId && s.pin) return s as StaffSession;
  } catch {}
  return null;
}

export function setStaffSession(s: StaffSession) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export function clearStaffSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

/** Routes a PIN user is allowed to open. */
export const STAFF_PATHS = ["/receiving", "/closing"];

export function isStaffAllowedPath(pathname: string) {
  return STAFF_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Browser-side SHA-256, matching the server's hashPin(). */
export async function hashPinBrowser(name: string, pin: string) {
  const enc = new TextEncoder().encode(
    `linecheck:${name.trim().toLowerCase()}:${pin.trim()}`,
  );
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
