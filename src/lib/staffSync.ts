// Sync for PIN (name + PIN) team-member sessions. Uses public server
// functions that verify the PIN server-side and read/write the owner's
// synced state.
import { lsStore } from "@/lib/lsStore";
import type { StaffSession } from "@/lib/staffSession";
import { staffPullState, staffPushState } from "@/lib/staffAuth.functions";

const PREFIX = "linecheck:";
let session: StaffSession | null = null;
let suppress = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsub: (() => void) | null = null;

function snapshot(): Record<string, string> {
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
  if (!session) return;
  if (isOffline()) {
    pendingWhileOffline = true;
    return;
  }
  try {
    await staffPushState({
      data: { name: session.name, pin: session.pin, patch: snapshot() },
    });
    pendingWhileOffline = false;
  } catch (e) {
    pendingWhileOffline = true;
    console.warn("[staff-sync] push failed", e);
  }
}

function onBackOnline() {
  if (session && pendingWhileOffline) void pushNow();
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


function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    void pushNow();
  }
}

async function pullNow() {
  if (!session || isOffline()) return;
  try {
    const res = await staffPullState({ data: { name: session.name, pin: session.pin } });
    const remote = res?.ok ? res.state : null;
    if (!remote) return;
    let changed = false;
    suppress = true;
    try {
      for (const [k, v] of Object.entries(remote)) {
        if (typeof v === "string" && k.startsWith(PREFIX) && lsStore.getItem(k) !== v) {
          lsStore.setItem(k, v);
          changed = true;
        }
      }
    } finally {
      suppress = false;
    }
    if (changed && typeof window !== "undefined") {
      window.dispatchEvent(new Event("linecheck:update"));
      window.dispatchEvent(new Event("linecheck:staff-update"));
      window.dispatchEvent(new Event("linecheck:members-update"));
      window.dispatchEvent(new Event("linecheck:brand-update"));
    }
  } catch (e) {
    console.warn("[staff-sync] pull failed", e);
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function onVisible() {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "hidden") flush();
  else void pullNow();
}

export async function startStaffSync(s: StaffSession) {
  if (session && session.id === s.id) return;
  stopStaffSync();
  session = s;
  if (typeof window !== "undefined" && !unsub) {
    const onWrite = () => schedulePush();
    window.addEventListener("linecheck:local-write", onWrite);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("online", onBackOnline);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") void pullNow();
    }, 30000);
    unsub = () => {
      window.removeEventListener("linecheck:local-write", onWrite);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("online", onBackOnline);
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
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (unsub) {
    unsub();
    unsub = null;
  }
}
