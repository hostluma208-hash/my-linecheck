// Compress an image File to a JPEG data URL, capped at maxDim on the longest edge
// and at roughly maxBytes of encoded data so device storage stays within quota.
// Falls back to the original data URL if compression fails.
export async function compressImageFile(
  file: File,
  maxDim = 1024,
  quality = 0.7,
  maxBytes = 120 * 1024,
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

    const encode = (dim: number, q: number) => {
      const scale = Math.min(1, dim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", q);
    };

    let out = encode(maxDim, quality);
    if (!out) return original;

    // Step down quality, then dimensions, until the encoded photo fits the budget.
    const steps: Array<[number, number]> = [
      [maxDim, 0.6],
      [maxDim, 0.45],
      [Math.round(maxDim * 0.75), 0.5],
      [Math.round(maxDim * 0.55), 0.45],
      [640, 0.4],
      [480, 0.35],
    ];
    for (const [dim, q] of steps) {
      if (out.length <= maxBytes) break;
      const next = encode(dim, q);
      if (next && next.length < out.length) out = next;
    }

    // Only return compressed if it's actually smaller.
    return out && out.length < original.length ? out : original;
  } catch {
    return original;
  }
}
