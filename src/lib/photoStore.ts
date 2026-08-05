// Photo attachments live in cloud storage instead of localStorage, so device
// quota is never the limiting factor. `savePhoto` compresses the file, uploads
// it to the private `attachments` bucket and returns a long-lived signed URL
// that can be used directly as an <img src>.
//
// Offline: the upload fails, so we fall back to the inline data URL (previous
// behaviour) and `uploadPendingPhotos()` later converts any leftover data URLs
// found in `linecheck:*` records into cloud URLs once connectivity returns.
import { supabase } from "@/integrations/supabase/client";
import { compressImageFile } from "@/lib/image";
import { lsStore } from "@/lib/lsStore";

const BUCKET = "attachments";
const TEN_YEARS = 60 * 60 * 24 * 365 * 10;
const PREFIX = "linecheck:";

function extFor(type: string) {
  if (type.includes("webp")) return "webp";
  if (type.includes("png")) return "png";
  return "jpg";
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const [head, body] = dataUrl.split(",");
    if (!head || !body) return null;
    const type = head.slice(head.indexOf(":") + 1, head.indexOf(";")) || "image/jpeg";
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
}

/** Upload a blob and return a long-lived signed URL, or null on failure. */
export async function uploadPhotoBlob(blob: Blob): Promise<string | null> {
  try {
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extFor(blob.type)}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
    if (error) throw error;
    const { data, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, TEN_YEARS);
    if (signErr || !data?.signedUrl) throw signErr ?? new Error("sign failed");
    return data.signedUrl;
  } catch (e) {
    console.warn("[photos] upload failed", e);
    return null;
  }
}

/**
 * Compress a picked file and store it in the cloud. Returns a URL string, or an
 * inline data URL when the upload isn't possible (offline).
 */
export async function savePhoto(file: File): Promise<string> {
  const dataUrl = await compressImageFile(file);
  if (!dataUrl) return "";
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return dataUrl;
  const url = await uploadPhotoBlob(blob);
  return url ?? dataUrl;
}

async function replaceDataUrls(value: unknown): Promise<{ value: unknown; changed: boolean }> {
  if (typeof value === "string") {
    if (!value.startsWith("data:image/")) return { value, changed: false };
    const blob = dataUrlToBlob(value);
    if (!blob) return { value, changed: false };
    const url = await uploadPhotoBlob(blob);
    return url ? { value: url, changed: true } : { value, changed: false };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out: unknown[] = [];
    for (const item of value) {
      const r = await replaceDataUrls(item);
      changed = changed || r.changed;
      out.push(r.value);
    }
    return { value: out, changed };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = await replaceDataUrls(v);
      changed = changed || r.changed;
      out[k] = r.value;
    }
    return { value: out, changed };
  }
  return { value, changed: false };
}

let running = false;

/** Move any inline photos still stored on the device up to cloud storage. */
export async function uploadPendingPhotos() {
  if (running) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  running = true;
  try {
    for (const key of lsStore.keys()) {
      if (!key.startsWith(PREFIX)) continue;
      const raw = lsStore.getItem(key);
      if (!raw || !raw.includes("data:image/")) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const { value, changed } = await replaceDataUrls(parsed);
      if (changed) lsStore.setItem(key, JSON.stringify(value));
    }
  } catch (e) {
    console.warn("[photos] pending upload sweep failed", e);
  } finally {
    running = false;
  }
}
