// Sync for PIN (name + PIN) team-member sessions. Uses public server
// functions that verify the PIN server-side and read/write the owner's
// synced state.
//
// Offline behaviour mirrors `sync.ts`: local writes are queued durably, win
// over remote values on the next pull, and are retried with backoff until the
// server confirms them.
import { getKeyRevision, isProtectedKey, lsStore } from "@/lib/lsStore";
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
const REMOTE_PAGE_SIZE = 250;
type RemoteRow = { key: string; value: string; updated_at: string };
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

function snapshot(): Record<string, string> {
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

function newestFirst(a: RemoteRow, b: RemoteRow) {
  const priority = Number(isProtectedKey(b.key)) - Number(isProtectedKey(a.key));
  if (priority !== 0) return priority;
  return b.updated_at.localeCompare(a.updated_at);
}

async function fetchRemoteRows(token: string, priorityOnly = false) {
  const rows: RemoteRow[] = [];
  for (let from = 0; ; from += REMOTE_PAGE_SIZE) {
    const res = await staffPullState({
      data: { token, from, limit: REMOTE_PAGE_SIZE, priorityOnly },
    });
    if (!res?.ok) throw new Error("PIN session expired");
    const page = res.rows as RemoteRow[];
    rows.push(...page);
    if (page.length < REMOTE_PAGE_SIZE) break;
  }
  return rows;
}

function restoreRows(
  rows: RemoteRow[],
  dirtyAtStart: Set<string>,
  dirty: Set<string>,
  revisionsAtStart: Map<string, number>,
) {
  let changed = false;
  for (const { key, value } of rows.sort(newestFirst)) {
    const unchangedSinceRequest =
      getKeyRevision(key) === (revisionsAtStart.get(key) ?? 0);
    if (
      typeof value === "string" &&
      key.startsWith(PREFIX) &&
      !dirtyAtStart.has(key) &&
      !dirty.has(key) &&
      unchangedSinceRequest &&
      lsStore.getItem(key) !== value
    ) {
      if (lsStore.setItem(key, value, { quiet: true })) changed = true;
    }
  }
  return changed;
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
  const data = snapshot();
  const pushedRevisions = new Map(
    [...pushedKeys].map((key) => [key, getKeyRevision(key)]),
  );
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
    const confirmedKeys = [...pushedKeys].filter(
      (key) => getKeyRevision(key) === pushedRevisions.get(key),
    );
    clearDirty(s, confirmedKeys);
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
    // Restore station names, uploaded templates and settings before loading
    // large historical records. This keeps a fresh Android device usable even
    // when the owner's complete cloud snapshot exceeds its browser quota.
    const priorityRows = await fetchRemoteRows(sessionAtStart.token, true);
    if (session?.id !== sessionAtStart.id) return;
    let dirty = getDirty(s);
    let changed = false;
    suppress = true;
    try {
      changed = restoreRows(priorityRows, dirtyAtStart, dirty, revisionsAtStart);
    } finally {
      suppress = false;
    }
    if (changed && typeof window !== "undefined") {
      window.dispatchEvent(new Event("linecheck:update"));
      window.dispatchEvent(new Event("linecheck:staff-update"));
      window.dispatchEvent(new Event("linecheck:brand-update"));
    }

    const rows = await fetchRemoteRows(sessionAtStart.token);
    if (session?.id !== sessionAtStart.id) return;
    dirty = getDirty(s);
    suppress = true;
    try {
      changed = restoreRows(rows, dirtyAtStart, dirty, revisionsAtStart) || changed;
    } finally {
      suppress = false;
    }
    if (changed && typeof window !== "undefined") {
      window.dispatchEvent(new Event("linecheck:update"));
      window.dispatchEvent(new Event("linecheck:staff-update"));
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
