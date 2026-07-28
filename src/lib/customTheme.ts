export type CustomColors = {
  primary: string;
  background: string;
  accent: string;
};

export const DEFAULT_CUSTOM: CustomColors = {
  primary: "#c4654a",
  background: "#faf8f5",
  accent: "#87a878",
};

export const CUSTOM_KEY = "linecheck:theme-custom";
export const CUSTOM_CSS_KEY = "linecheck:theme-custom-css";

function hexToRgb(hex: string) {
  const h = hex.replace("#", "").trim();
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const num = parseInt(n || "000000", 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex(r: number, g: number, b: number) {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function relLum(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const s = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}

export function contrastRatio(a: string, b: string) {
  const l1 = relLum(a);
  const l2 = relLum(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick near-black or near-white based on background luminance for guaranteed contrast. */
export function readableOn(bg: string) {
  return relLum(bg) > 0.5 ? "#0f172a" : "#f8fafc";
}

function mix(a: string, b: string, t: number) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

/**
 * Ensure a text color meets at least a target contrast ratio against bg by
 * nudging it toward black or white. Keeps hue while raising readability.
 */
export function ensureContrast(text: string, bg: string, target = 4.5) {
  if (contrastRatio(text, bg) >= target) return text;
  const goal = relLum(bg) > 0.5 ? "#000000" : "#ffffff";
  let out = text;
  for (let t = 0.1; t <= 1; t += 0.1) {
    out = mix(text, goal, t);
    if (contrastRatio(out, bg) >= target) return out;
  }
  return goal;
}

export function buildCustomThemeCss(c: CustomColors) {
  const bgLight = relLum(c.background) > 0.5;
  const fg = readableOn(c.background);
  const primaryFg = readableOn(c.primary);
  const accentFg = readableOn(c.accent);

  const card = bgLight ? mix(c.background, "#ffffff", 0.5) : mix(c.background, "#ffffff", 0.08);
  const muted = bgLight ? mix(c.background, "#000000", 0.06) : mix(c.background, "#ffffff", 0.08);
  const mutedFg = ensureContrast(bgLight ? mix(fg, c.background, 0.4) : mix(fg, c.background, 0.3), c.background, 4.5);
  const border = bgLight ? mix(c.background, "#000000", 0.14) : mix(c.background, "#ffffff", 0.18);
  const sidebar = bgLight ? mix(c.background, "#000000", 0.03) : mix(c.background, "#ffffff", 0.04);
  const secondary = bgLight ? mix(c.accent, "#ffffff", 0.72) : mix(c.accent, "#000000", 0.55);
  const secondaryFg = readableOn(secondary);
  const primarySoft = bgLight ? mix(c.primary, "#ffffff", 0.55) : mix(c.primary, "#000000", 0.5);
  const sidebarAccent = bgLight ? mix(c.accent, "#ffffff", 0.6) : mix(c.accent, "#000000", 0.5);
  const sidebarAccentFg = readableOn(sidebarAccent);

  return `[data-theme="custom"]{
  --background:${c.background};
  --foreground:${fg};
  --card:${card};
  --card-foreground:${fg};
  --popover:${card};
  --popover-foreground:${fg};
  --primary:${c.primary};
  --primary-foreground:${primaryFg};
  --primary-soft:${primarySoft};
  --secondary:${secondary};
  --secondary-foreground:${secondaryFg};
  --muted:${muted};
  --muted-foreground:${mutedFg};
  --accent:${c.accent};
  --accent-foreground:${accentFg};
  --sage:${c.accent};
  --sage-foreground:${accentFg};
  --sage-deep:${mix(c.accent, "#000000", 0.35)};
  --border:${border};
  --input:${border};
  --ring:${c.primary};
  --sidebar:${sidebar};
  --sidebar-foreground:${fg};
  --sidebar-primary:${c.primary};
  --sidebar-primary-foreground:${primaryFg};
  --sidebar-accent:${sidebarAccent};
  --sidebar-accent-foreground:${sidebarAccentFg};
  --sidebar-border:${border};
  --sidebar-ring:${c.primary};
}`;
}

import { lsStore } from "@/lib/lsStore";

export function loadCustomTheme(): CustomColors {
  try {
    const raw = lsStore.getItem(CUSTOM_KEY);
    if (raw) return { ...DEFAULT_CUSTOM, ...JSON.parse(raw) };
    // Legacy unscoped fallback.
    const legacy = typeof window !== "undefined" ? localStorage.getItem(CUSTOM_KEY) : null;
    if (legacy) return { ...DEFAULT_CUSTOM, ...JSON.parse(legacy) };
  } catch {}
  return DEFAULT_CUSTOM;
}

export function applyCustomStyle(css: string) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("linecheck-custom-theme") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "linecheck-custom-theme";
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function saveCustomTheme(c: CustomColors) {
  const css = buildCustomThemeCss(c);
  try {
    lsStore.setItem(CUSTOM_KEY, JSON.stringify(c));
    lsStore.setItem(CUSTOM_CSS_KEY, css);
    // Mirror unscoped so pre-hydration paint on this browser matches next reload.
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(c));
    localStorage.setItem(CUSTOM_CSS_KEY, css);
  } catch {}
  applyCustomStyle(css);
}
