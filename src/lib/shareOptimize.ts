// Helpers that make "generate share link" fast:
// 1) photos embedded as base64 data URLs are downscaled before upload
// 2) an identical payload re-published for the same record returns the
//    previously created link instantly instead of hitting the network.
import { lsStore } from "@/lib/lsStore";

const MAX_DIM = 900;
const QUALITY = 0.6;

const memo = new Map<string, string>();

/** Downscale a base64 image data URL in the browser. Returns input on failure. */
async function shrinkDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image")) return dataUrl;
  if (typeof document === "undefined") return dataUrl;
  const cached = memo.get(dataUrl);
  if (cached) return cached;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode failed"));
      i.src = dataUrl;
    });
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", QUALITY);
    const best = out && out.length < dataUrl.length ? out : dataUrl;
    memo.set(dataUrl, best);
    return best;
  } catch {
    return dataUrl;
  }
}

/** Deep-walk a payload and shrink every embedded image data URL. */
export async function optimizePayload<T>(payload: T): Promise<T> {
  const walk = async (value: unknown): Promise<unknown> => {
    if (typeof value === "string") {
      return value.startsWith("data:image") ? await shrinkDataUrl(value) : value;
    }
    if (Array.isArray(value)) return Promise.all(value.map(walk));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      const entries = Object.entries(value as Record<string, unknown>);
      const vals = await Promise.all(entries.map(([, v]) => walk(v)));
      entries.forEach(([k], i) => (out[k] = vals[i]));
      return out;
    }
    return value;
  };
  return (await walk(payload)) as T;
}

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h * 33) ^ input.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}:${input.length.toString(36)}`;
}

function cacheKey(kind: string, recordKey: string) {
  return `linecheck:share-cache:${kind}:${recordKey}`;
}

/** Returns a previously published URL when the payload hasn't changed. */
export function getCachedShareUrl(
  kind: string,
  recordKey: string,
  payload: unknown,
): string | null {
  try {
    const raw = lsStore.getItem(cacheKey(kind, recordKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { hash?: string; url?: string };
    if (!parsed?.url || !parsed?.hash) return null;
    return parsed.hash === hash(JSON.stringify(payload)) ? parsed.url : null;
  } catch {
    return null;
  }
}

export function setCachedShareUrl(
  kind: string,
  recordKey: string,
  payload: unknown,
  url: string,
) {
  try {
    lsStore.setItem(
      cacheKey(kind, recordKey),
      JSON.stringify({ hash: hash(JSON.stringify(payload)), url }),
    );
  } catch {}
}
