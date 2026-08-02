import { getEffectiveSections } from "./lineCheck";

/** Convert a station name into a URL-safe slug without %20 escapes. */
export function stationSlug(name: string): string {
  return name.trim().replace(/\s+/g, "-");
}

/** Resolve a slug back to the real station name (falls back to hyphen→space). */
export function stationFromSlug(slug: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(slug);
    } catch {
      return slug;
    }
  })();
  if (typeof window !== "undefined") {
    try {
      const match = getEffectiveSections().find(
        (s) => stationSlug(s.name).toLowerCase() === decoded.toLowerCase(),
      );
      if (match) return match.name;
    } catch {
      /* ignore */
    }
  }
  return decoded.replace(/-/g, " ");
}
