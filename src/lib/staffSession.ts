// Simple "name + PIN" team-member session, stored in this browser only.
// PIN users get read/write access to the stations of the account (owner)
// that created their PIN login, limited by the permissions the owner set.

export type StaffPermissions = {
  /** Station names this manager may open. null/undefined = all stations. */
  stations: string[] | null;
  history: boolean;
  settings: boolean;
};

export type StaffSession = {
  id: string;
  name: string;
  ownerId: string;
  /** Short-lived, revocable session token (never the PIN itself). */
  token: string;
  perms?: StaffPermissions;
};

const KEY = "linecheck:staff-session";

export const DEFAULT_STAFF_PERMS: StaffPermissions = {
  stations: null,
  history: false,
  settings: false,
};

export function getStaffSession(): StaffSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.id && s.name && s.ownerId && s.token) return s as StaffSession;
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

/** Permissions of the signed-in PIN user (null when not a PIN user). */
export function getStaffPermissions(): StaffPermissions | null {
  const s = getStaffSession();
  if (!s) return null;
  return { ...DEFAULT_STAFF_PERMS, ...(s.perms ?? {}) };
}

/** Station names the signed-in PIN user may see, or null for "all". */
export function staffStationFilter(): string[] | null {
  const p = getStaffPermissions();
  if (!p || !Array.isArray(p.stations)) return null;
  return p.stations;
}

export function isStaffAllowedPath(pathname: string) {
  const p = getStaffPermissions();
  if (!p) return true;
  const blocked: string[] = [];
  if (!p.history) blocked.push("/history");
  if (!p.settings) blocked.push("/settings");
  return !blocked.some((b) => pathname === b || pathname.startsWith(b + "/"));
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
