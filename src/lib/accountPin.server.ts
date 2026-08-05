import { createHash } from "node:crypto";

export type AccountPinCreds = { email: string; pin: string };

/** Deterministic hash of an account PIN, salted with the account email. */
export function hashAccountPin(email: string, pin: string) {
  return createHash("sha256")
    .update(`linecheck:account:${email.trim().toLowerCase()}:${pin.trim()}`, "utf8")
    .digest("hex");
}

export function validAccountPin(input: AccountPinCreds): AccountPinCreds {
  const email = String(input?.email ?? "").trim().toLowerCase();
  const pin = String(input?.pin ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4-8 digits");
  return { email, pin };
}
