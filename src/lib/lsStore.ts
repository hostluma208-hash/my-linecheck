// Per-user scoped localStorage wrapper.
// Keys are transparently namespaced with the current user id so multiple
// accounts on the same browser stay isolated. Default scope is "guest".

let currentUid = "guest";
const listeners = new Set<() => void>();
const REVISION_PREFIX = "linecheck:revision:";

export function setUserScope(uid: string | null) {
  const next = uid || "guest";
  if (next === currentUid) return;
  currentUid = next;
  for (const fn of listeners) fn();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("linecheck:scope-change"));
  }
}

export function getUserScope() {
  return currentUid;
}

export function onScopeChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function scopedKey(raw: string) {
  return `u:${currentUid}:${raw}`;
}

function safe(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function revisionStorageKey(key: string) {
  return `${REVISION_PREFIX}${currentUid}:${encodeURIComponent(key)}`;
}

/**
 * A durable, monotonic revision for one logical key in the active account.
 * It changes even when the serialized value is identical, which lets sync
 * distinguish a newer repeated Mark All action from the copy already in flight.
 */
export function getKeyRevision(key: string): number {
  const s = safe();
  if (!s) return 0;
  const value = Number(s.getItem(revisionStorageKey(key)) ?? "0");
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function bumpKeyRevision(key: string): number {
  const s = safe();
  const next = getKeyRevision(key) + 1;
  // Revision bookkeeping must never break a write when storage is full.
  try {
    if (s) s.setItem(revisionStorageKey(key), String(next));
  } catch {}
  return next;
}


function emitWrite(key: string, revision: number) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("linecheck:local-write", { detail: { key, revision } }),
    );
  }
}

function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: string; code?: number; message?: string };
  return (
    err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err.code === 22 ||
    err.code === 1014 ||
    /quota/i.test(err.message || "")
  );
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const PHOTO_KEY_RE = /photo|attachment|image/i;

/** Replace every embedded base64 image inside a JSON blob with "". */
function stripDataUrls(json: string): string | null {
  if (!json.includes("data:image")) return null;
  try {
    const walk = (v: unknown): unknown => {
      if (typeof v === "string") return v.startsWith("data:image") ? "" : v;
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          out[k] = walk(val);
        }
        return out;
      }
      return v;
    };
    const next = JSON.stringify(walk(JSON.parse(json)));
    return next.length < json.length ? next : null;
  } catch {
    return null;
  }
}

/**
 * Reclaim space by dropping the heaviest disposable data first: old photo
 * attachments, then base64 images embedded inside older daily records.
 * Text records (marks, temps, notes), templates and settings are preserved —
 * only the images inside old records are removed.
 */
function reclaimSpace(protectKey: string, aggressive: boolean): boolean {
  const s = safe();
  if (!s) return false;
  const cutoff = isoDaysAgo(aggressive ? 2 : 14);
  const today = isoDaysAgo(0);
  const victims: string[] = [];
  const strippable: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const raw = s.key(i);
    if (!raw || raw === protectKey) continue;
    if (!raw.startsWith("u:")) continue;
    const m = raw.match(DATE_RE);
    const day = m ? m[1] : null;
    const isOld = day ? day < cutoff : false;
    const isPhotoKey = PHOTO_KEY_RE.test(raw);

    if (isPhotoKey && (isOld || (aggressive && day !== today))) {
      victims.push(raw);
    } else if (day && day !== today && (isOld || aggressive)) {
      strippable.push(raw);
    }
  }

  let freed = false;
  for (const k of victims) {
    try {
      s.removeItem(k);
      freed = true;
    } catch {}
  }
  for (const k of strippable) {
    try {
      const cur = s.getItem(k);
      if (!cur) continue;
      const next = stripDataUrls(cur);
      if (next === null) continue;
      s.setItem(k, next);
      freed = true;
    } catch {}
  }
  return freed;
}

/**
 * Background housekeeping: trims images from records older than two weeks so
 * the device rarely gets close to the storage quota in the first place.
 * Safe to call on every app start.
 */
export function pruneOldAttachments(): void {
  try {
    reclaimSpace("", false);
  } catch {}
}

/** Rough share (0..1) of the storage quota already used, when measurable. */
export async function storagePressure(): Promise<number | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (!usage || !quota) return null;
    return usage / quota;
  } catch {
    return null;
  }
}

/** Prune proactively once the device is running low, before writes can fail. */
export async function runStorageHousekeeping(): Promise<void> {
  pruneOldAttachments();
  const pressure = await storagePressure();
  if (pressure !== null && pressure > 0.8) {
    try {
      reclaimSpace("", true);
    } catch {}
  }
}

function notifyStorageFull() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("linecheck:storage-full"));
}


export const lsStore = {
  getItem(key: string) {
    const s = safe();
    return s ? s.getItem(scopedKey(key)) : null;
  },
  setItem(key: string, value: string, opts?: { quiet?: boolean }) {
    const s = safe();
    if (s) {
      const full = scopedKey(key);
      try {
        s.setItem(full, value);
      } catch (e) {
        if (!isQuotaError(e)) throw e;
        let saved = false;
        for (const aggressive of [false, true]) {
          if (!reclaimSpace(full, aggressive)) continue;
          try {
            s.setItem(full, value);
            saved = true;
            break;
          } catch (e2) {
            if (!isQuotaError(e2)) throw e2;
          }
        }
        if (!saved) {
          // Quiet writes are background sync mirrors: the device simply keeps
          // its current copy instead of alarming the user mid-login.
          if (opts?.quiet) return false;
          notifyStorageFull();
          throw e;
        }
      }
    }
    emitWrite(key, bumpKeyRevision(key));
    return true;
  },

  removeItem(key: string) {
    const s = safe();
    if (s) s.removeItem(scopedKey(key));
    emitWrite(key, bumpKeyRevision(key));
  },

  /** List raw (un-prefixed) keys belonging to the current user. */
  keys(): string[] {
    const s = safe();
    if (!s) return [];
    const prefix = `u:${currentUid}:`;
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out;
  },
};
