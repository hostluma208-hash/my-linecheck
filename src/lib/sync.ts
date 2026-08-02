// Cross-device sync: mirrors all `linecheck:*` localStorage keys (scoped to
// the signed-in user) to the `user_state` table. On sign-in we pull the
// remote snapshot; every local write is debounced and pushed back.
import { supabase } from "@/integrations/supabase/client";
import { lsStore, getUserScope } from "@/lib/lsStore";

const PREFIX = "linecheck:";
let suppressPush = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
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

let pendingWhileOffline = false;

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function pushNow() {
  if (!currentUserId) return;
  if (isOffline()) {
    // Keep the change locally; it is pushed as soon as we're back online.
    pendingWhileOffline = true;
    return;
  }
  const data = collectSnapshot();
  try {
    const { error } = await supabase
      .from("user_state")
      .upsert(
        { user_id: currentUserId, data, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    pendingWhileOffline = false;
  } catch (e) {
    pendingWhileOffline = true;
    console.warn("[sync] push failed", e);
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
  if (pendingWhileOffline) void pushNow();
  else void pullFromServer();
}


function onLocalWrite() {
  schedulePush();
}

async function pullFromServer() {
  if (!currentUserId) return;
  const userAtStart = currentUserId;
  try {
    const { data, error } = await supabase
      .from("user_state")
      .select("data")
      .eq("user_id", currentUserId)
      .maybeSingle();
    if (error) throw error;
    // Account switched while the request was in flight — discard.
    if (currentUserId !== userAtStart) return;
    const remote = (data?.data ?? null) as Record<string, string> | null;
    if (!remote) {
      // No remote yet — push whatever we have locally so future devices see it.
      await pushNow();
      return;
    }
    let changed = false;
    suppressPush = true;
    try {
      const localKeys = new Set(lsStore.keys().filter((k) => k.startsWith(PREFIX)));
      for (const [k, v] of Object.entries(remote)) {
        if (typeof v === "string" && k.startsWith(PREFIX)) {
          if (lsStore.getItem(k) !== v) {
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
        if (lastRemoteKeys.has(k)) {
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
    // If we had unpushed local-only keys, push the merged snapshot back up.
    if (localOnlyPending()) void pushNow();
  } catch (e) {
    console.warn("[sync] pull failed", e);
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
    void pullFromServer();
  }
}

export async function startSync(userId: string) {
  if (currentUserId === userId) return;
  // Switching accounts: drop any state tied to the previous user.
  stopSync();
  currentUserId = userId;
  lastRemoteKeys = new Set();
  pendingWhileOffline = false;
  if (typeof window !== "undefined" && !unsubWrite) {
    window.addEventListener("linecheck:local-write", onLocalWrite);
    window.addEventListener("pagehide", flushPendingPush);
    window.addEventListener("beforeunload", flushPendingPush);
    window.addEventListener("online", onBackOnline);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    // Periodic refresh so changes made on another device show up here.
    pollTimer = setInterval(() => {
      if (currentUserId && !isOffline() && document.visibilityState === "visible") {
        void pullFromServer();
      }
    }, 30000);
    unsubWrite = () => {
      window.removeEventListener("linecheck:local-write", onLocalWrite);
      window.removeEventListener("pagehide", flushPendingPush);
      window.removeEventListener("beforeunload", flushPendingPush);
      window.removeEventListener("online", onBackOnline);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }
  if (!isOffline()) await pullFromServer();
}



export function stopSync() {
  currentUserId = null;
  lastRemoteKeys = new Set();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (unsubWrite) {
    unsubWrite();
    unsubWrite = null;
  }
}

export function isSuppressingPush() {
  return suppressPush;
}
