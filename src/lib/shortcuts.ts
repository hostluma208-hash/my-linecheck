import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getEffectiveSections } from "@/lib/lineCheck";
import { stationSlug } from "@/lib/slug";

/** True when the event target is a text-entry element — shortcuts must not
 *  fire while the user is typing. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

/**
 * Global keyboard shortcuts (work on every page inside the app shell):
 *  - Ctrl/Cmd + 1..9  → jump to station #1..#9
 *  - Ctrl/Cmd + D     → dashboard
 *  - Ctrl/Cmd + H     → history
 *  - Ctrl/Cmd + ,     → settings
 * Station pages add their own (see src/routes/$name.tsx):
 *  - Ctrl/Cmd + Enter        → mark all OK
 *  - Ctrl/Cmd + Shift+Enter  → unmark all
 *  - Ctrl/Cmd + ← / →        → previous / next station
 */
export function useGlobalShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();

      if (key >= "1" && key <= "9") {
        const s = getEffectiveSections()[Number(key) - 1];
        if (s) {
          e.preventDefault();
          navigate({ to: "/$name", params: { name: stationSlug(s.name) } });
        }
        return;
      }
      if (e.shiftKey) return;
      if (key === "d") {
        e.preventDefault();
        navigate({ to: "/" });
      } else if (key === "h") {
        e.preventDefault();
        navigate({ to: "/history" });
      } else if (key === ",") {
        e.preventDefault();
        navigate({ to: "/settings" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
