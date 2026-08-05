// Device-local persistence for sub-account (team member PIN) sessions.
//
// Everything a sub-account touches already lives in localStorage under the
// owner scope, but two things were missing for "works on this device":
//   1. the browser could evict that storage (PWA / low disk),
//   2. signing in again required the server, so an offline device could not
//      restore its own sub-account session.
// This module fixes both: it asks for persistent storage, and it keeps a
// device-local record of every sub-account that has successfully signed in
// here (PIN kept only as a salted SHA-256 hash, never in plain text).

import { hashPinBrowser, type StaffSession } from "@/lib/staffSession";

const DEVICE_ACCOUNTS_KEY = "linecheck:device:staff-accounts";

export type DeviceStaffAccount = {
  id: string;
  name: string;
  ownerId: string;
  pinHash: string;
  lastLoginAt: number;
};

/** Ask the browser to keep this device's data instead of evicting it. */
export async function requestPersistentStorage() {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

function readAccounts(): DeviceStaffAccount[] {
  try {
    const raw = localStorage.getItem(DEVICE_ACCOUNTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as DeviceStaffAccount[]) : [];
  } catch {
    return [];
  }
}

function writeAccounts(list: DeviceStaffAccount[]) {
  try {
    localStorage.setItem(DEVICE_ACCOUNTS_KEY, JSON.stringify(list));
  } catch {}
}

/** Sub-accounts that have signed in on this device before. */
export function listDeviceStaffAccounts(): DeviceStaffAccount[] {
  return readAccounts().sort((a, b) => b.lastLoginAt - a.lastLoginAt);
}

/** Remember a verified sub-account so it can sign in on this device offline. */
export async function rememberDeviceStaffAccount(session: StaffSession) {
  const pinHash = await hashPinBrowser(session.name, session.pin);
  const rest = readAccounts().filter((a) => a.id !== session.id);
  rest.push({
    id: session.id,
    name: session.name,
    ownerId: session.ownerId,
    pinHash,
    lastLoginAt: Date.now(),
  });
  writeAccounts(rest);
  void requestPersistentStorage();
}

/** Offline fallback: verify a name + PIN against this device's own records. */
export async function verifyDeviceStaffAccount(
  name: string,
  pin: string,
): Promise<StaffSession | null> {
  const who = name.trim().toLowerCase();
  const candidates = readAccounts().filter((a) => a.name.trim().toLowerCase() === who);
  if (candidates.length === 0) return null;
  const hash = await hashPinBrowser(name, pin);
  const match = candidates.find((a) => a.pinHash === hash);
  return match
    ? { id: match.id, name: match.name, ownerId: match.ownerId, pin }
    : null;
}

export function forgetDeviceStaffAccount(id: string) {
  writeAccounts(readAccounts().filter((a) => a.id !== id));
}
