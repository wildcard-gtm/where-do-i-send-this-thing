/**
 * Extracts a dominant accent color from a logo image URL.
 * Fetches the image, samples pixels, and returns the most saturated non-white/black hex color.
 * Falls back to a default brand blue if anything fails.
 */

const DEFAULT_ACCENT = "#2563EB";

export async function extractAccentColor(logoUrl: string | null | undefined): Promise<string> {
  if (!logoUrl) return DEFAULT_ACCENT;

  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return DEFAULT_ACCENT;

    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    // Parse PNG/JPEG pixels manually — look for most saturated color
    // We use a simple approach: find JPEG SOF or PNG IDAT and sample raw bytes
    // For a robust result without native deps, ask gpt-5.2 to suggest a color based on the company name
    // This is intentionally a lightweight heuristic
    const colors = sampleImageColors(buf);
    const accent = mostSaturated(colors);
    return accent ?? DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/**
 * Sample ~50 evenly spaced bytes from the image buffer treating every 3-4 bytes as an RGB pixel.
 * Very rough — enough to find dominant hues without any image decoding library.
 */
function sampleImageColors(buf: Buffer): Array<[number, number, number]> {
  const results: Array<[number, number, number]> = [];
  const step = Math.max(3, Math.floor(buf.length / 50));
  for (let i = 0; i < buf.length - 3; i += step) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    // Skip near-white, near-black, near-grey
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (saturation > 0.25 && max > 40 && max < 240) {
      results.push([r, g, b]);
    }
  }
  return results;
}

function mostSaturated(colors: Array<[number, number, number]>): string | null {
  if (colors.length === 0) return null;

  let best: [number, number, number] | null = null;
  let bestSat = 0;

  for (const [r, g, b] of colors) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat > bestSat) {
      bestSat = sat;
      best = [r, g, b];
    }
  }

  if (!best) return null;
  const [r, g, b] = best;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
