// Cross-device sync: mirrors all `linecheck:*` localStorage keys (scoped to
// the signed-in user) to the `user_state` table. On sign-in we pull the
// remote snapshot; every local write is debounced and pushed back.
//
// Offline behaviour: local writes are recorded in a durable dirty-key queue
// (see `pendingSync.ts`). Those keys win over remote values on the next pull
// and are pushed as soon as connectivity returns — including after a reload
// or an app restart that happened while still offline.
import { supabase } from "@/integrations/supabase/client";
import {
  getKeyRevision,
  isProtectedKey,
  lsStore,
  shrinkForRestore,
} from "@/lib/lsStore";
import {
  backoffDelay,
  clearDirty,
  dirtyCount,
  getDirty,
  hasDirty,
  isDefinitelyOffline,
  markDirty,
  setSyncStatus,
} from "@/lib/pendingSync";

const PREFIX = "linecheck:";
const REMOTE_PAGE_SIZE = 250;
const REMOTE_PRIORITY_FILTER = [
  "key.like.linecheck:settings:%",
  "key.like.linecheck:order:%",
  "key.like.linecheck:theme%",
  "key.eq.linecheck:closing-template",
  "key.like.linecheck:section-items:%",
].join(",");
type RemoteRow = { key: string; value: string; updated_at: string };
let suppressPush = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let pushing = false;
let currentUserId: string | null = null;
let unsubWrite: (() => void) | null = null;
let lastRemoteKeys = new Set<string>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function collectSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of lsStore.keys()) {
    if (!k.startsWith(PREFIX)) continue;
    const v = lsStore.getItem(k);
    if (v != null) out[k] = v;
  }
  return out;
}

function isOffline() {
  return isDefinitelyOffline();
}

function remotePriority(row: RemoteRow) {
  if (isProtectedKey(row.key)) return 0;
  // New Android installs have a smaller local quota than the cloud snapshot.
  // Restore recent operational records before old history if the device fills.
  return 1;
}

function newestFirst(a: RemoteRow, b: RemoteRow) {
  const priority = remotePriority(a) - remotePriority(b);
  if (priority !== 0) return priority;
  return b.updated_at.localeCompare(a.updated_at);
}

async function fetchAllRemoteRows(userId: string): Promise<RemoteRow[]> {
  const rows: RemoteRow[] = [];
  for (let from = 0; ; from += REMOTE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("app_records")
      .select("key, value, updated_at")
      .eq("owner_id", userId)
      .order("key", { ascending: true })
      .range(from, from + REMOTE_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as RemoteRow[];
    rows.push(...page);
    if (page.length < REMOTE_PAGE_SIZE) break;
  }
  return rows;
}

function refreshStatus() {
  if (!currentUserId) return setSyncStatus("idle");
  const n = dirtyCount(currentUserId);
  if (pushing) return setSyncStatus("syncing", n);
  if (n > 0) {
    setSyncStatus(isOffline() || retryAttempt > 0 ? "pending" : "syncing", n);
    return;
  }
  setSyncStatus("idle");
}

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryAttempt = 0;
}

function scheduleRetry() {
  if (retryTimer || !currentUserId) return;
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void pushNow();
  }, backoffDelay(retryAttempt));
  refreshStatus();
}

async function pushNow() {
  if (!currentUserId) return;
  if (pushing) return;
  if (isOffline()) {
    // Keep the change locally; it is pushed as soon as we're back online.
    refreshStatus();
    return;
  }
  const userAtStart = currentUserId;
  const data = collectSnapshot();
  // Snapshot the dirty keys we're about to deliver; writes landing during the
  // request stay queued for the next push.
  const pushedKeys = getDirty(userAtStart);
  const pushedRevisions = new Map(
    [...pushedKeys].map((key) => [key, getKeyRevision(key)]),
  );
  pushing = true;
  refreshStatus();
  try {
    // One database row per record. Keys the server already knows about but
    // that no longer exist locally are deleted; the rest are upserted.
    const rows = Object.entries(data).map(([key, value]) => ({
      owner_id: userAtStart,
      key,
      value,
      updated_at: new Date().toISOString(),
    }));
    // Only delete a cloud record when the key was intentionally removed on this
    // device (a removal marks the key dirty). A key that merely went missing
    // locally — cleared browser cache, storage housekeeping, a quiet write that
    // failed — must never wipe the cloud copy. Settings are never deleted.
    const removed = [...lastRemoteKeys].filter(
      (k) => !(k in data) && pushedKeys.has(k) && !isProtectedKey(k),
    );
    if (rows.length) {
      const { error } = await supabase
        .from("app_records")
        .upsert(rows, { onConflict: "owner_id,key" });
      if (error) throw error;
    }
    if (removed.length) {
      const { error } = await supabase
        .from("app_records")
        .delete()
        .eq("owner_id", userAtStart)
        .in("key", removed);
      if (error) throw error;
    }
    if (currentUserId !== userAtStart) return;
    // A key may be written again with the exact same JSON while this request is
    // in flight (rapid repeated Mark All). Value comparison cannot distinguish
    // that newer action, so only acknowledge the exact per-key revision sent.
    const confirmedKeys = [...pushedKeys].filter(
      (key) => getKeyRevision(key) === pushedRevisions.get(key),
    );
    clearDirty(userAtStart, confirmedKeys);
    lastRemoteKeys = new Set(Object.keys(data));

    clearRetry();
  } catch (e) {
    console.warn("[sync] push failed", e);
    if (currentUserId === userAtStart) scheduleRetry();
  } finally {
    pushing = false;
    refreshStatus();
    if (currentUserId === userAtStart && !retryTimer && hasDirty(userAtStart)) {
      // Writes arrived mid-flight — deliver them.
      schedulePush();
    }
  }
}

function schedulePush() {
  if (suppressPush || !currentUserId) return;
  if (pushTimer) clearTimeout(pushTimer);
  // Save immediately; the tiny delay only coalesces writes fired in the same tick.
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushNow();
  }, 100);
}

function onBackOnline() {
  if (!currentUserId) return;
  clearRetry();
  // Merge remote first (local dirty keys win), then deliver the queue.
  void pullFromServer();
}

function onLocalWrite(e: Event) {
  if (suppressPush || !currentUserId) return;
  const key = (e as CustomEvent<{ key?: string; revision?: number }>).detail?.key;
  if (key && key.startsWith(PREFIX)) {
    markDirty(currentUserId, key);
  }
  refreshStatus();
  schedulePush();
}

async function pullFromServer() {
  if (!currentUserId) return;
  const userAtStart = currentUserId;
  const dirtyAtStart = getDirty(userAtStart);
  const revisionsAtStart = new Map(
    lsStore
      .keys()
      .filter((key) => key.startsWith(PREFIX))
      .map((key) => [key, getKeyRevision(key)]),
  );
  try {
    // Restore the small, irreplaceable configuration first. On Android the
    // complete account history may be larger than the browser storage quota,
    // but stations, uploaded templates, ordering and settings must still load.
    const { data: priorityData, error: priorityError } = await supabase
      .from("app_records")
      .select("key, value, updated_at")
      .eq("owner_id", userAtStart)
      .or(REMOTE_PRIORITY_FILTER)
      .order("updated_at", { ascending: false });
    if (priorityError) throw priorityError;
    if (currentUserId !== userAtStart) return;

    let priorityChanged = false;
    suppressPush = true;
    try {
      for (const row of (priorityData ?? []) as RemoteRow[]) {
        if (
          row.key.startsWith(PREFIX) &&
          !dirtyAtStart.has(row.key) &&
          getKeyRevision(row.key) === (revisionsAtStart.get(row.key) ?? 0) &&
          lsStore.getItem(row.key) !== row.value
        ) {
          const v = shrinkForRestore(row.key, row.value);
          if (v != null && lsStore.setItem(row.key, v, { quiet: true }))
            priorityChanged = true;
        }
      }
    } finally {
      suppressPush = false;
    }
    if (priorityChanged && typeof window !== "undefined") {
      window.dispatchEvent(new Event("linecheck:update"));
      window.dispatchEvent(new Event("linecheck:staff-update"));
      window.dispatchEvent(new Event("linecheck:brand-update"));
    }

    const rows = await fetchAllRemoteRows(userAtStart);
    // Account switched while the request was in flight — discard.
    if (currentUserId !== userAtStart) return;
    const remote: Record<string, string> | null = rows.length
      ? Object.fromEntries(rows.map((r) => [r.key, r.value]))
      : null;
    if (!remote) {
      // No remote yet — push whatever we have locally so future devices see it.
      await pushNow();
      return;
    }

    // Unsynced local edits always win over the remote snapshot.
    const dirty = getDirty(userAtStart);
    let changed = false;
    suppressPush = true;
    try {
      const localKeys = new Set(lsStore.keys().filter((k) => k.startsWith(PREFIX)));
      for (const row of rows.sort(newestFirst)) {
        const { key: k, value: v } = row;
        if (typeof v === "string" && k.startsWith(PREFIX)) {
           const unchangedSinceRequest =
             getKeyRevision(k) === (revisionsAtStart.get(k) ?? 0);
           if (
             !dirtyAtStart.has(k) &&
             !dirty.has(k) &&
             unchangedSinceRequest &&
             lsStore.getItem(k) !== v
           ) {
            const fit = shrinkForRestore(k, v);
            if (fit != null && lsStore.setItem(k, fit, { quiet: true })) changed = true;
          }
          localKeys.delete(k);
        }
      }
      // Keys that were in the last synced snapshot but are gone remotely were
      // deleted on another device — mirror that deletion here. Keys never seen
      // on the server are local-only (unpushed) and stay intact.
      for (const k of localKeys) {
        const unchangedSinceRequest =
          getKeyRevision(k) === (revisionsAtStart.get(k) ?? 0);
        if (
          lastRemoteKeys.has(k) &&
          !dirtyAtStart.has(k) &&
          !dirty.has(k) &&
          unchangedSinceRequest
        ) {
          lsStore.removeItem(k);
          changed = true;
        }
      }
      lastRemoteKeys = new Set(Object.keys(remote));
    } finally {
      suppressPush = false;
    }
    if (changed && typeof window !== "undefined") {
      window.dispatchEvent(new Event("linecheck:update"));
      window.dispatchEvent(new Event("linecheck:staff-update"));
      window.dispatchEvent(new Event("linecheck:brand-update"));
    }
    // Deliver queued offline edits, or local-only keys the server hasn't seen.
    if (hasDirty(userAtStart) || localOnlyPending()) void pushNow();
    else refreshStatus();
  } catch (e) {
    console.warn("[sync] pull failed", e);
    if (currentUserId === userAtStart && hasDirty(userAtStart)) scheduleRetry();
  }
}

function localOnlyPending() {
  for (const k of lsStore.keys()) {
    if (k.startsWith(PREFIX) && !lastRemoteKeys.has(k)) return true;
  }
  return false;
}

function flushPendingPush() {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
    void pushNow();
  }
}

function onVisible() {
  if (document.visibilityState === "hidden") {
    flushPendingPush();
  } else if (currentUserId && !isOffline()) {
    if (hasDirty(currentUserId)) {
      clearRetry();
      void pushNow();
    }
    void pullFromServer();
  }
}

export async function startSync(userId: string) {
  if (currentUserId === userId) return;
  // Switching accounts: drop any state tied to the previous user.
  stopSync();
  currentUserId = userId;
  lastRemoteKeys = new Set();
  refreshStatus();
  if (typeof window !== "undefined" && !unsubWrite) {
    window.addEventListener("linecheck:local-write", onLocalWrite);
    window.addEventListener("pagehide", flushPendingPush);
    window.addEventListener("beforeunload", flushPendingPush);
    window.addEventListener("online", onBackOnline);
    window.addEventListener("offline", refreshStatus);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    // Periodic refresh so changes made on another device show up here, and a
    // safety net that retries a stuck queue even if no `online` event fires.
    pollTimer = setInterval(() => {
      if (!currentUserId || isOffline()) return;
      if (hasDirty(currentUserId) && !retryTimer && !pushing) void pushNow();
      if (document.visibilityState === "visible") void pullFromServer();
    }, 30000);
    unsubWrite = () => {
      window.removeEventListener("linecheck:local-write", onLocalWrite);
      window.removeEventListener("pagehide", flushPendingPush);
      window.removeEventListener("beforeunload", flushPendingPush);
      window.removeEventListener("online", onBackOnline);
      window.removeEventListener("offline", refreshStatus);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }
  if (isOffline()) return;
  // A queue left over from a previous offline session is merged, then flushed.
  await pullFromServer();
}

export function stopSync() {
  currentUserId = null;
  lastRemoteKeys = new Set();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  clearRetry();
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (unsubWrite) {
    unsubWrite();
    unsubWrite = null;
  }
  setSyncStatus("idle");
}

export function isSuppressingPush() {
  return suppressPush;
}

/** Number of local changes still waiting to reach the server. */
export function pendingChangeCount() {
  return currentUserId ? dirtyCount(currentUserId) : 0;
}
