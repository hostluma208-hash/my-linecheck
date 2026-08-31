// Sync for PIN (name + PIN) team-member sessions. Uses public server
// functions that verify the PIN server-side and read/write the owner's
// synced state.
//
// Offline behaviour mirrors `sync.ts`: local writes are queued durably, win
// over remote values on the next pull, and are retried with backoff until the
// server confirms them.
import { getKeyRevision, lsStore } from "@/lib/lsStore";
import type { StaffSession } from "@/lib/staffSession";
import { staffPullState, staffPushState } from "@/lib/staffAuth.functions";
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
let session: StaffSession | null = null;
let suppress = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let pushing = false;
let unsub: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function scope() {
  return session ? `staff:${session.id}` : null;
}

/** Keys the server has already confirmed for this session. */
let syncedKeys = new Set<string>();

/** Only the records that changed locally (or the server has never seen). */
function delta(dirty: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of lsStore.keys()) {
    if (!k.startsWith(PREFIX)) continue;
    if (!dirty.has(k) && syncedKeys.has(k)) continue;
    const v = lsStore.getItem(k);
    if (v != null) out[k] = v;
  }
  return out;
}


function isOffline() {
  return isDefinitelyOffline();
}

function refreshStatus() {
  const s = scope();
  if (!s) return setSyncStatus("idle");
  const n = dirtyCount(s);
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
  if (retryTimer || !session) return;
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void pushNow();
  }, backoffDelay(retryAttempt));
  refreshStatus();
}

async function pushNow() {
  const s = scope();
  if (!session || !s || pushing) return;
  if (isOffline()) {
    refreshStatus();
    return;
  }
  const sessionAtStart = session;
  const pushedKeys = getDirty(s);
  const data = delta(pushedKeys);
  const sentKeys = Object.keys(data);
  const pushedRevisions = new Map(
    sentKeys.map((key) => [key, getKeyRevision(key)]),
  );
  if (!sentKeys.length) {
    clearDirty(s, pushedKeys);
    refreshStatus();
    return;
  }
  pushing = true;
  refreshStatus();
  try {
    await staffPushState({
      data: {
        token: sessionAtStart.token,
        patch: data,
      },
    });
    if (session?.id !== sessionAtStart.id) return;
    // Same-value repeated writes still represent newer Mark All actions. Only
    // acknowledge the exact per-key revision included in this request.
    const confirmedKeys = sentKeys.filter(
      (key) => getKeyRevision(key) === pushedRevisions.get(key),
    );
    clearDirty(s, confirmedKeys);
    for (const k of sentKeys) syncedKeys.add(k);

    clearRetry();
  } catch (e) {
    console.warn("[staff-sync] push failed", e);
    if (session?.id === sessionAtStart.id) scheduleRetry();
  } finally {
    pushing = false;
    refreshStatus();
    if (session?.id === sessionAtStart.id && !retryTimer && hasDirty(s)) {
      schedulePush();
    }
  }
}

function onBackOnline() {
  if (!session) return;
  clearRetry();
  void pullNow();
}

function schedulePush() {
  if (suppress || !session) return;
  if (timer) clearTimeout(timer);
  // Save immediately; the tiny delay only coalesces writes fired in the same tick.
  timer = setTimeout(() => {
    timer = null;
    void pushNow();
  }, 100);
}

function onWrite(e: Event) {
  const s = scope();
  if (suppress || !s) return;
  const key = (e as CustomEvent<{ key?: string; revision?: number }>).detail?.key;
  if (key && key.startsWith(PREFIX)) {
    markDirty(s, key);
  }
  refreshStatus();
  schedulePush();
}

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    void pushNow();
  }
}

async function pullNow() {
  const s = scope();
  if (!session || !s || isOffline()) return;
  const sessionAtStart = session;
  const dirtyAtStart = getDirty(s);
  const revisionsAtStart = new Map(
    lsStore
      .keys()
      .filter((key) => key.startsWith(PREFIX))
      .map((key) => [key, getKeyRevision(key)]),
  );
  try {
    const res = await staffPullState({
      data: { token: sessionAtStart.token },
    });
    if (session?.id !== sessionAtStart.id) return;
    const remote = res?.ok ? res.state : null;
    // Unsynced local edits always win over the remote snapshot.
    const dirty = getDirty(s);
    let changed = false;
    if (remote) {
      suppress = true;
      try {
        for (const [k, v] of Object.entries(remote)) {
          const unchangedSinceRequest =
            getKeyRevision(k) === (revisionsAtStart.get(k) ?? 0);
          if (
            typeof v === "string" &&
            k.startsWith(PREFIX) &&
            !dirtyAtStart.has(k) &&
            !dirty.has(k) &&
            unchangedSinceRequest &&
            lsStore.getItem(k) !== v
          ) {
            if (lsStore.setItem(k, v, { quiet: true })) changed = true;
          }
        }
      } finally {
        suppress = false;
      }
    }
    if (changed && typeof window !== "undefined") {
      window.dispatchEvent(new Event("linecheck:update"));
      window.dispatchEvent(new Event("linecheck:staff-update"));
      window.dispatchEvent(new Event("linecheck:members-update"));
      window.dispatchEvent(new Event("linecheck:brand-update"));
    }
    if (hasDirty(s)) void pushNow();
    else refreshStatus();
  } catch (e) {
    console.warn("[staff-sync] pull failed", e);
    if (session?.id === sessionAtStart.id && hasDirty(s)) scheduleRetry();
  }
}

function onVisible() {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "hidden") flush();
  else void pullNow();
}

export async function startStaffSync(s: StaffSession) {
  if (session && session.id === s.id) return;
  stopStaffSync();
  session = s;
  refreshStatus();
  if (typeof window !== "undefined" && !unsub) {
    window.addEventListener("linecheck:local-write", onWrite);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("online", onBackOnline);
    window.addEventListener("offline", refreshStatus);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    pollTimer = setInterval(() => {
      const sc = scope();
      if (!sc || isOffline()) return;
      if (hasDirty(sc) && !retryTimer && !pushing) void pushNow();
      if (document.visibilityState === "visible") void pullNow();
    }, 30000);
    unsub = () => {
      window.removeEventListener("linecheck:local-write", onWrite);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("online", onBackOnline);
      window.removeEventListener("offline", refreshStatus);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }
  if (isOffline()) return; // keep working from local data
  await pullNow();
}

export function stopStaffSync() {
  session = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  clearRetry();
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (unsub) {
    unsub();
    unsub = null;
  }
  setSyncStatus("idle");
}

/** Number of local changes still waiting to reach the server. */
export function pendingStaffChangeCount() {
  const s = scope();
  return s ? dirtyCount(s) : 0;
}
