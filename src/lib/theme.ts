// Per-user theme persistence. Uses lsStore so values are scoped to the
// signed-in user and synced across devices via the sync manager.
import { lsStore, onScopeChange } from "@/lib/lsStore";

export const THEME_MODE_KEY = "linecheck:theme"; // "dark" | "light"
export const THEME_PRESET_KEY = "linecheck:theme-preset"; // preset id
export const THEME_CUSTOM_CSS_KEY = "linecheck:theme-custom-css";

export function applyStoredTheme() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  // Mode (dark/light) — fall back to unscoped/system for guests.
  let mode = lsStore.getItem(THEME_MODE_KEY);
  if (!mode) {
    try {
      mode = localStorage.getItem(THEME_MODE_KEY);
    } catch {}
  }
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const isDark = mode === "dark" || (!mode && prefersDark);
  root.classList.toggle("dark", isDark);

  // Preset — fall back to unscoped for guests.
  let preset = lsStore.getItem(THEME_PRESET_KEY);
  if (!preset) {
    try {
      preset = localStorage.getItem(THEME_PRESET_KEY);
    } catch {}
  }
  if (preset && preset !== "terracotta") root.setAttribute("data-theme", preset);
  else root.removeAttribute("data-theme");

  // Custom CSS block
  const existing = document.getElementById("linecheck-custom-theme");
  if (preset === "custom") {
    let css = lsStore.getItem(THEME_CUSTOM_CSS_KEY);
    if (!css) {
      try {
        css = localStorage.getItem(THEME_CUSTOM_CSS_KEY);
      } catch {}
    }
    if (css) {
      let el = existing as HTMLStyleElement | null;
      if (!el) {
        el = document.createElement("style");
        el.id = "linecheck-custom-theme";
        document.head.appendChild(el);
      }
      el.textContent = css;
    }
  } else if (existing) {
    existing.remove();
  }
}

let installed = false;
export function installThemeSync() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Re-apply after sign-in scope change and after remote pull hydrates state.
  onScopeChange(() => applyStoredTheme());
  window.addEventListener("linecheck:update", () => applyStoredTheme());
}
