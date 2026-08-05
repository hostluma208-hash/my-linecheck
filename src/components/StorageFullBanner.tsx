import { useEffect, useState } from "react";
import { HardDrive, X } from "lucide-react";

/**
 * Shown when a local write failed because device storage is full, even after
 * old attachments were cleaned up automatically.
 */
export function StorageFullBanner() {
  const [full, setFull] = useState(false);

  useEffect(() => {
    const onFull = () => setFull(true);
    window.addEventListener("linecheck:storage-full", onFull);
    return () => window.removeEventListener("linecheck:storage-full", onFull);
  }, []);

  if (!full) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-destructive px-3 py-1.5 text-center text-xs font-medium text-destructive-foreground">
      <HardDrive className="h-3.5 w-3.5 shrink-0" />
      Device storage is full — remove some photo attachments so new changes can be
      saved.
      <button
        type="button"
        aria-label="Dismiss storage warning"
        className="ml-1 opacity-80 hover:opacity-100"
        onClick={() => setFull(false)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
