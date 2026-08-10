import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, CloudUpload } from "lucide-react";
import {
  getPendingCount,
  getSyncStatus,
  subscribeSync,
  type SyncStatus,
} from "@/lib/pendingSync";

/**
 * Shown while the device is offline, or while local changes are still waiting
 * to reach the server after connectivity returns.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const unsub = subscribeSync(() => {
      setStatus(getSyncStatus());
      setPending(getPendingCount());
    });
    setStatus(getSyncStatus());
    setPending(getPendingCount());
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      unsub();
    };
  }, []);

  if (offline) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-xs font-medium text-amber-950">
        <WifiOff className="h-3.5 w-3.5" />
        Offline — {pending > 0 ? `${pending} change${pending === 1 ? "" : "s"} saved on this device and will sync` : "your changes are saved on this device and will sync"}{" "}
        when you're back online.
      </div>
    );
  }

  if (status === "syncing" && pending > 0) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-muted px-3 py-1.5 text-center text-xs font-medium text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Syncing {pending} offline change{pending === 1 ? "" : "s"}…
      </div>
    );
  }

  if (status === "pending" && pending > 0) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-xs font-medium text-amber-950">
        <CloudUpload className="h-3.5 w-3.5" />
        {pending} change{pending === 1 ? "" : "s"} waiting to sync — retrying…
      </div>
    );
  }


  return null;
}
