import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** Small banner shown while the device has no internet connection. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-xs font-medium text-amber-950">
      <WifiOff className="h-3.5 w-3.5" />
      Offline — your changes are saved on this device and will sync when you're back
      online.
    </div>
  );
}
