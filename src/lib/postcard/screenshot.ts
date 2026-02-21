/**
 * Renders a postcard to a PNG by calling the /api/postcards/[id]/image route,
 * which uses next/og (satori) — no Chromium or Playwright required.
 * Returns base64-encoded PNG data.
 */
export async function screenshotPostcard(postcardId: string): Promise<string> {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  const imageUrl = `${appUrl}/api/postcards/${postcardId}/image`;

  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Image render failed: ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}
