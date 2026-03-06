/**
 * Detect whether a profile image URL is a placeholder/avatar (not a real human photo).
 * Three layers, cheapest first:
 *  1. URL pattern match (free, instant)
 *  2. File size check (one HTTP HEAD or small GET)
 *  3. Color uniqueness check (download + analyze pixels)
 */

import https from 'https';
import http from 'http';

/** Known generic/placeholder avatar URL patterns */
const PLACEHOLDER_URL_PATTERNS = [
  'static.licdn.com/aero-v1/sc/h/',    // LinkedIn default gray silhouette
  'static.licdn.com/sc/h/',             // Older LinkedIn default
  '/default-avatar',
  'gravatar.com/avatar/',
  'ui-avatars.com/',
  'placehold.co/',
  'placeholder.com/',
  '/ghost-',
  '/blank-profile',
];

export type PhotoCheckResult = 'real' | 'placeholder' | 'missing' | 'error';

/** Fast URL pattern check — no network needed */
export function isPlaceholderUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  return PLACEHOLDER_URL_PATTERNS.some(pattern => url.includes(pattern));
}

/** Download image and count unique colors in a sample. Few colors = placeholder. */
async function downloadAndCheckColors(url: string): Promise<PhotoCheckResult> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;

    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; photo-check/1.0)' },
      timeout: 10000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, (res: any) => {
      // Follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        downloadAndCheckColors(res.headers.location).then(resolve);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); resolve('error'); return; }

      const contentType: string = res.headers['content-type'] ?? '';
      if (contentType.includes('svg')) { res.resume(); resolve('placeholder'); return; }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);

        // Tiny images are almost certainly placeholders
        if (buffer.length < 3000) {
          resolve('placeholder');
          return;
        }

        // Sample raw pixel bytes for color diversity
        // For PNG/JPEG we sample raw buffer bytes in groups of 3 (approximate RGB)
        // Real photos have high color diversity, placeholders have very low
        const colors = new Set<string>();
        const step = Math.max(3, Math.floor(buffer.length / 3000) * 3); // sample ~1000 pixels
        for (let i = 0; i < buffer.length - 2; i += step) {
          colors.add(`${buffer[i]},${buffer[i + 1]},${buffer[i + 2]}`);
        }

        // LinkedIn placeholder has ~10-30 unique sampled colors
        // Real human photos have 200+ even with aggressive sampling
        resolve(colors.size < 60 ? 'placeholder' : 'real');
      });
      res.on('error', () => resolve('error'));
    });

    req.on('error', () => resolve('error'));
    req.on('timeout', () => { req.destroy(); resolve('error'); });
  });
}

/** Full check: URL pattern → download + color analysis */
export async function checkPhoto(url: string | null | undefined): Promise<PhotoCheckResult> {
  if (!url) return 'missing';
  if (isPlaceholderUrl(url)) return 'placeholder';

  try {
    return await downloadAndCheckColors(url);
  } catch {
    return 'error';
  }
}
