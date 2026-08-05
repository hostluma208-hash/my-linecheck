// Compress an image File to a small data URL (WebP when supported, else JPEG),
// capped at maxDim on the longest edge and at roughly maxBytes of encoded data
// so device storage stays within quota. Falls back to the original on failure.

let cachedType: "image/webp" | "image/jpeg" | null = null;

function bestType(): "image/webp" | "image/jpeg" {
  if (cachedType) return cachedType;
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    cachedType = c.toDataURL("image/webp").startsWith("data:image/webp")
      ? "image/webp"
      : "image/jpeg";
  } catch {
    cachedType = "image/jpeg";
  }
  return cachedType;
}

export async function compressImageFile(
  file: File,
  maxDim = 800,
  quality = 0.65,
  maxBytes = 70 * 1024,
): Promise<string> {
  const readAsDataUrl = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });

  const original = await readAsDataUrl(file);
  if (!original) return "";
  if (typeof window === "undefined" || typeof document === "undefined") return original;

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image decode failed"));
      i.src = original;
    });

    const type = bestType();
    const encode = (dim: number, q: number) => {
      const scale = Math.min(1, dim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";
      // White matte so transparent PNGs don't turn black once flattened.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL(type, q);
    };

    let out = encode(maxDim, quality);
    if (!out) return original;

    // Progressively shrink quality then dimensions until the photo fits budget.
    let dim = maxDim;
    let q = quality;
    for (let i = 0; i < 8 && out.length > maxBytes; i++) {
      if (q > 0.35) q = Math.max(0.35, q - 0.12);
      else dim = Math.max(320, Math.round(dim * 0.75));
      const next = encode(dim, q);
      if (!next) break;
      if (next.length < out.length) out = next;
      if (dim <= 320 && q <= 0.35) break;
    }

    // Only return compressed if it's actually smaller.
    return out && out.length < original.length ? out : original;
  } catch {
    return original;
  }
}
