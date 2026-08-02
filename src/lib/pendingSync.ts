// Durable offline write-queue bookkeeping shared by the account sync
// (`sync.ts`) and the staff PIN sync (`staffSync.ts`).
//
// Why this exists: both syncs mirror a whole `linecheck:*` snapshot to the
// server. Without a *persisted* record of which keys changed while offline,
// closing the app before reconnecting loses the edits — on next launch the
// remote snapshot is pulled and overwrites the newer local values. We record
// dirty keys in localStorage so they survive reloads, win over remote values
// on the next pull, and get pushed as soon as connectivity returns.

const STORE_PREFIX = "linecheck:pending:";

export type SyncStatus = "idle" | "pending" | "syncing" | "error";

let status: SyncStatus = "idle";
let pendingCount = 0;
const listeners = new Set<() => void>();

function raw(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(scope: string): string[] {
  const s = raw();
  if (!s) return [];
  try {
    const v = s.getItem(STORE_PREFIX + scope);
    const parsed = v ? JSON.parse(v) : null;
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function write(scope: string, keys: string[]) {
  const s = raw();
  if (!s) return;
  try {
    if (keys.length === 0) s.removeItem(STORE_PREFIX + scope);
    else s.setItem(STORE_PREFIX + scope, JSON.stringify(keys));
  } catch {
    /* quota / private mode — in-memory behaviour still applies */
  }
  emit();
}

function emit() {
  for (const fn of listeners) fn();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("linecheck:sync-status"));
  }
}

/** Record that `key` changed locally and has not reached the server yet. */
export function markDirty(scope: string, key: string) {
  const keys = read(scope);
  if (keys.includes(key)) return;
  keys.push(key);
  write(scope, keys);
}

/** Keys changed locally but not yet confirmed by the server. */
export function getDirty(scope: string): Set<string> {
  return new Set(read(scope));
}

export function hasDirty(scope: string): boolean {
  return read(scope).length > 0;
}

export function dirtyCount(scope: string): number {
  return read(scope).length;
}

/**
 * Clear the keys that were included in a successful push. Keys written while
 * the request was in flight are kept so the next push picks them up.
 */
export function clearDirty(scope: string, pushed: Iterable<string>) {
  const pushedSet = new Set(pushed);
  const remaining = read(scope).filter((k) => !pushedSet.has(k));
  write(scope, remaining);
}

export function clearAllDirty(scope: string) {
  write(scope, []);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function setSyncStatus(next: SyncStatus, count = 0) {
  if (status === next && pendingCount === count) return;
  status = next;
  pendingCount = count;
  emit();
}

/** Local changes still waiting to reach the server for the active session. */
export function getPendingCount() {
  return pendingCount;
}

export function subscribeSync(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Exponential backoff with jitter, capped at 30s. */
export function backoffDelay(attempt: number) {
  const base = Math.min(30000, 1000 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 250);
}

/**
 * `navigator.onLine === false` is trustworthy (definitely offline); `true`
 * only means "attached to a network", so pushes must still be retried on
 * failure rather than assumed delivered.
 */
export function isDefinitelyOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
