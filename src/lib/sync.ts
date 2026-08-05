// Cross-device sync: mirrors all `linecheck:*` localStorage keys (scoped to
// the signed-in user) to the `user_state` table. On sign-in we pull the
// remote snapshot; every local write is debounced and pushed back.
//
// Offline behaviour: local writes are recorded in a durable dirty-key queue
// (see `pendingSync.ts`). Those keys win over remote values on the next pull
// and are pushed as soon as connectivity returns — including after a reload
// or an app restart that happened while still offline.
import { supabase } from "@/integrations/supabase/client";
import { lsStore } from "@/lib/lsStore";
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
let suppressPush = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let pushing = false;
let currentUserId: string | null = null;
let unsubWrite: (() => void) | null = null;
let lastRemoteKeys = new Set<string>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let localRevision = 0;

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
  pushing = true;
  refreshStatus();
  try {
    const { error } = await supabase
      .from("user_state")
      .upsert(
        { user_id: userAtStart, data, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    if (currentUserId !== userAtStart) return;
    // A key may be written again while this request is in flight. Only clear
    // the queue entry when the value currently in storage is exactly the one
    // this request delivered; otherwise the newer edit must remain dirty and
    // be sent by the next push. This is especially important for Mark All,
    // which rewrites the same station key many times in quick succession.
    const confirmedKeys = [...pushedKeys].filter(
      (key) => lsStore.getItem(key) === data[key],
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
  const key = (e as CustomEvent<{ key?: string }>).detail?.key;
  if (key && key.startsWith(PREFIX)) {
    localRevision += 1;
    markDirty(currentUserId, key);
  }
  refreshStatus();
  schedulePush();
}

async function pullFromServer() {
  if (!currentUserId) return;
  const userAtStart = currentUserId;
  const revisionAtStart = localRevision;
  try {
    const { data, error } = await supabase
      .from("user_state")
      .select("data")
      .eq("user_id", currentUserId)
      .maybeSingle();
    if (error) throw error;
    // Account switched while the request was in flight — discard.
    if (currentUserId !== userAtStart) return;
    // The response describes a snapshot from before a local edit. Even if a
    // fast push has already acknowledged that edit and cleared its dirty key,
    // this older pull must never be allowed to restore the previous value.
    if (localRevision !== revisionAtStart) {
      if (hasDirty(userAtStart)) void pushNow();
      return;
    }
    const remote = (data?.data ?? null) as Record<string, string> | null;
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
      for (const [k, v] of Object.entries(remote)) {
        if (typeof v === "string" && k.startsWith(PREFIX)) {
          if (!dirty.has(k) && lsStore.getItem(k) !== v) {
            lsStore.setItem(k, v);
            changed = true;
          }
          localKeys.delete(k);
        }
      }
      // Keys that were in the last synced snapshot but are gone remotely were
      // deleted on another device — mirror that deletion here. Keys never seen
      // on the server are local-only (unpushed) and stay intact.
      for (const k of localKeys) {
        if (lastRemoteKeys.has(k) && !dirty.has(k)) {
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
      window.dispatchEvent(new Event("linecheck:members-update"));
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
  localRevision = 0;
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
  localRevision = 0;
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
