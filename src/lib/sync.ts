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

function collectSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of lsStore.keys()) {
    if (!k.startsWith(PREFIX)) continue;
    const v = lsStore.getItem(k);
    if (v != null) out[k] = v;
  }
  return out;
}

async function pushNow() {
  if (!currentUserId) return;
  const data = collectSnapshot();
  try {
    await supabase
      .from("user_state")
      .upsert(
        { user_id: currentUserId, data, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
  } catch (e) {
    console.warn("[sync] push failed", e);
  }
}

function schedulePush() {
  if (suppressPush || !currentUserId) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushNow();
  }, 800);
}

function onLocalWrite() {
  schedulePush();
}

async function pullFromServer() {
  if (!currentUserId) return;
  try {
    const { data, error } = await supabase
      .from("user_state")
      .select("data")
      .eq("user_id", currentUserId)
      .maybeSingle();
    if (error) throw error;
    const remote = (data?.data ?? null) as Record<string, string> | null;
    if (!remote) {
      // No remote yet — push whatever we have locally so future devices see it.
      await pushNow();
      return;
    }
    suppressPush = true;
    try {
      // Merge: overwrite with remote values, but preserve any local-only keys
      // (e.g. writes that hadn't been pushed yet before a refresh).
      const localKeys = new Set(lsStore.keys().filter((k) => k.startsWith(PREFIX)));
      for (const [k, v] of Object.entries(remote)) {
        if (typeof v === "string" && k.startsWith(PREFIX)) {
          lsStore.setItem(k, v);
          localKeys.delete(k);
        }
      }
      // localKeys now contains local-only keys — leave them intact.
    } finally {
      suppressPush = false;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("linecheck:update"));
      window.dispatchEvent(new Event("linecheck:staff-update"));
      window.dispatchEvent(new Event("linecheck:brand-update"));
    }
    // If we had unpushed local-only keys, push the merged snapshot back up.
    void pushNow();
  } catch (e) {
    console.warn("[sync] pull failed", e);
  }
}

function flushPendingPush() {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
    void pushNow();
  }
}

export async function startSync(userId: string) {
  if (currentUserId === userId) return;
  currentUserId = userId;
  // Make sure lsStore scope has been set to this user before pulling.
  if (getUserScope() !== userId) {
    // Scope is expected to be set by the auth listener; still safe to proceed.
  }
  if (typeof window !== "undefined" && !unsubWrite) {
    window.addEventListener("linecheck:local-write", onLocalWrite);
    window.addEventListener("pagehide", flushPendingPush);
    window.addEventListener("beforeunload", flushPendingPush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushPendingPush();
    });
    unsubWrite = () => {
      window.removeEventListener("linecheck:local-write", onLocalWrite);
      window.removeEventListener("pagehide", flushPendingPush);
      window.removeEventListener("beforeunload", flushPendingPush);
    };
  }
  await pullFromServer();
}


export function stopSync() {
  currentUserId = null;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (unsubWrite) {
    unsubWrite();
    unsubWrite = null;
  }
}

export function isSuppressingPush() {
  return suppressPush;
}
