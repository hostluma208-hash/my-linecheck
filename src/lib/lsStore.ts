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

/**
 * Reclaim space when localStorage is full: drop the heaviest disposable data
 * first (old photo attachments), then any other data keyed to an old date.
 * Never touches templates, settings, or today's work.
 */
function reclaimSpace(protectKey: string, aggressive: boolean): boolean {
  const s = safe();
  if (!s) return false;
  const cutoff = isoDaysAgo(aggressive ? 3 : 14);
  const dateRe = /(\d{4}-\d{2}-\d{2})/;
  const victims: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const raw = s.key(i);
    if (!raw || raw === protectKey) continue;
    if (!raw.startsWith("u:")) continue;
    const m = raw.match(dateRe);
    const isOld = m ? m[1] < cutoff : false;
    const isPhoto = /photo|attachment|image/i.test(raw);
    if ((isPhoto && isOld) || (aggressive && isPhoto && !raw.includes(isoDaysAgo(0)))) {
      victims.push(raw);
    } else if (isOld && aggressive) {
      victims.push(raw);
    }
  }

  if (!victims.length) return false;
  for (const k of victims) {
    try {
      s.removeItem(k);
    } catch {}
  }
  return true;
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
  setItem(key: string, value: string) {
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
          notifyStorageFull();
          throw e;
        }
      }
    }
    emitWrite(key, bumpKeyRevision(key));
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
