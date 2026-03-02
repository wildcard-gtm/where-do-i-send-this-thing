/**
 * Supabase Storage helper — uploads postcard images to S3-compatible storage.
 * Returns the public URL for the uploaded file.
 *
 * Uses the Supabase Storage REST API (no extra SDK dependency).
 * Requires env vars: SUPABASE_STORAGE_URL, SUPABASE_ANON_KEY
 */

const BUCKET = "postcards";

function getStorageConfig() {
  // Supabase project URL (e.g. https://xyz.supabase.co)
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
    );
  }

  return { supabaseUrl, serviceKey };
}

/**
 * Uploads a base64-encoded PNG to Supabase Storage.
 * @param base64 - raw base64 string (no data: prefix)
 * @param filePath - path within the bucket, e.g. "backgrounds/abc123.png"
 * @returns public URL of the uploaded file
 */
export async function uploadPostcardImage(
  base64: string,
  filePath: string
): Promise<string> {
  const { supabaseUrl, serviceKey } = getStorageConfig();

  const buffer = Buffer.from(base64, "base64");

  // Upload via Supabase Storage REST API
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${BUCKET}/${filePath}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "image/png",
      "x-upsert": "true",
      "cache-control": "no-store",
    },
    body: buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Storage upload failed (${res.status}): ${text}`);
  }

  // Append timestamp so browsers/CDN always fetch the latest version
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${filePath}?v=${Date.now()}`;
}

/**
 * Deletes a file from Supabase Storage.
 * @param filePath - path within the bucket, e.g. "backgrounds/abc123.png"
 */
export async function deletePostcardImage(filePath: string): Promise<void> {
  const { supabaseUrl, serviceKey } = getStorageConfig();

  const deleteUrl = `${supabaseUrl}/storage/v1/object/${BUCKET}`;

  await fetch(deleteUrl, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: [filePath] }),
  }).catch(() => {}); // Ignore deletion errors (file may not exist)
}

/**
 * Uploads a raw Buffer to Supabase Storage (for multipart file uploads).
 * @param buffer - raw file buffer
 * @param filePath - path within the bucket, e.g. "references/abc123/xyz.png"
 * @param contentType - MIME type, e.g. "image/png"
 * @returns public URL of the uploaded file
 */
export async function uploadReferenceImage(
  buffer: Buffer,
  filePath: string,
  contentType: string = "image/png"
): Promise<string> {
  const { supabaseUrl, serviceKey } = getStorageConfig();

  const uploadUrl = `${supabaseUrl}/storage/v1/object/${BUCKET}/${filePath}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": contentType,
      "x-upsert": "true",
      "cache-control": "no-store",
    },
    body: buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Storage upload failed (${res.status}): ${text}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${filePath}?v=${Date.now()}`;
}

/**
 * Extracts the storage file path from a public URL.
 * e.g. "https://xyz.supabase.co/storage/v1/object/public/postcards/backgrounds/abc.png"
 * → "backgrounds/abc.png"
 */
export function extractStoragePath(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.slice(idx + marker.length);
}
