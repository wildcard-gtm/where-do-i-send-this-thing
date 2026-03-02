import OpenAI from "openai";
import fs from "fs";
import path from "path";
import https from "https";

/**
 * Generates a background image for a postcard using OpenAI.
 * Tries gpt-image-1 first (higher quality), falls back to dall-e-3 if unavailable.
 * Returns base64-encoded PNG data.
 */
export async function generateBackground(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const client = new OpenAI({ apiKey });

  // Try gpt-image-1 first
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.images.generate as any)({
      model: "gpt-image-1",
      prompt,
      size: "1536x1024",
      quality: "high",
      output_format: "png",
      n: 1,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b64: string | undefined = (response as any).data?.[0]?.b64_json;
    if (b64) return b64;
    throw new Error("No base64 image in gpt-image-1 response");
  } catch {
    // Fall back to dall-e-3 — returns a URL, so we fetch and convert to base64
    const response = await client.images.generate({
      model: "dall-e-3",
      prompt,
      size: "1792x1024",
      quality: "standard",
      response_format: "b64_json",
      n: 1,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data returned from dall-e-3");
    return b64;
  }
}

// ─── OpenAI War Room / Zoom Room compositing (fallback for Gemini) ───────────

export interface OpenAICompositingInput {
  prospectPhotoUrl?: string | null;
  companyLogoUrl?: string | null;
  teamPhotoUrls?: string[];
  openRoles?: Array<{ title: string; location: string }>;
  prospectName?: string;
}

/** Fetch a remote image URL and return a Buffer */
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === "https:" ? https : require("http");

    const req = lib.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; postcard-bot/1.0)" },
      timeout: 15000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, (res: any) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        fetchImageBuffer(res.headers.location).then(resolve);
        return;
      }
      if (res.statusCode !== 200) { resolve(null); return; }

      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", () => resolve(null));
    });

    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

/** Build a File object from a Buffer for the OpenAI SDK */
function bufferToFile(buf: Buffer, filename: string, mimeType = "image/png"): File {
  return new File([buf], filename, { type: mimeType });
}

/**
 * War Room compositing via OpenAI gpt-image-1 (edit endpoint with reference images).
 * Same prompt and scene structure as Nano Banana — just uses OpenAI instead of Gemini.
 */
export async function generateWarRoomOpenAI(input: OpenAICompositingInput): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const client = new OpenAI({ apiKey });
  const templatesDir = path.join(process.cwd(), "public", "templates");

  // Load reference scene as the base image
  const referenceBuffer = fs.readFileSync(path.join(templatesDir, "reference-pose.png"));

  const rolesText = input.openRoles?.length
    ? input.openRoles.slice(0, 3).map((r) => `• ${r.title} — ${r.location}`).join("\n")
    : "• Senior Engineer — Remote\n• Product Manager — NYC\n• Designer — SF";

  // Build the same compositing prompt as Nano Banana
  const promptParts = [
    `Recreate this war room conference scene EXACTLY — same layout, same positions, same furniture, same lighting — but with the specific changes described below.`,
    `LAYOUT: far left whiteboard on wheels, center wooden conference table with seated people, ONE person standing near the head of the table holding a tablet, large wall-mounted screen on back wall, round logo medallion on back wall, "IT'S GO TIME" banner top right, city skyline windows left, industrial pendant lights.`,
  ];

  if (input.prospectPhotoUrl) {
    promptParts.push(`STANDING PERSON: Replace the standing person's face and appearance to match ${input.prospectName ?? "the prospect"} — accurately match their skin tone, hair color, hair style, and facial features. Keep the same standing pose.`);
  }

  promptParts.push(
    `WHITEBOARD: Show "TOP ROLES" header with these roles listed below in handwritten style:\n${rolesText}`,
    input.companyLogoUrl
      ? `LOGO: Replace the "HERE" medallion on the back wall with the company logo.`
      : `LOGO: Keep the "HERE" medallion as-is.`,
    `OUTPUT: Wide landscape image, 3:2 ratio. Bold cartoonish illustration style. Do NOT move any furniture or people.`,
  );

  const prompt = promptParts.join("\n");

  // Build images array — reference scene is first (used as base for editing)
  const images: File[] = [bufferToFile(referenceBuffer, "reference.png", "image/png")];

  // Prospect photo
  if (input.prospectPhotoUrl) {
    const buf = await fetchImageBuffer(input.prospectPhotoUrl);
    if (buf) images.push(bufferToFile(buf, "prospect.png", "image/jpeg"));
  }

  // Team photos (up to 4)
  if (input.teamPhotoUrls?.length) {
    const fetched = await Promise.all(input.teamPhotoUrls.slice(0, 4).map(fetchImageBuffer));
    fetched.forEach((buf, i) => {
      if (buf) images.push(bufferToFile(buf, `team${i}.png`, "image/jpeg"));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.images.edit as any)({
    model: "gpt-image-1",
    image: images,
    prompt,
    size: "1536x1024",
    quality: "high",
    output_format: "png",
    n: 1,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b64: string | undefined = (response as any).data?.[0]?.b64_json;
  if (!b64) throw new Error("No base64 image in gpt-image-1 edit response");
  return b64;
}

/**
 * Zoom Room compositing via OpenAI gpt-image-1 (edit endpoint with reference images).
 */
export async function generateZoomRoomOpenAI(input: OpenAICompositingInput): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const client = new OpenAI({ apiKey });
  const templatesDir = path.join(process.cwd(), "public", "templates");

  const referenceBuffer = fs.readFileSync(path.join(templatesDir, "zoom-room-reference.png"));

  const rolesText = input.openRoles?.length
    ? input.openRoles.slice(0, 3).map((r) => `• ${r.title} — ${r.location}`).join("\n")
    : "• Senior Engineer — Remote\n• Product Manager — Remote\n• Designer — Remote";

  const promptParts = [
    `Recreate this Zoom video call scene EXACTLY — same layout, same positions — but with the specific changes described below.`,
    `LAYOUT: Full Zoom window. Center person at desk with bookshelf, round "HERE" logo circle top center, left-side whiteboard panel "Top Roles Hiring:", right-side strip of 4 video call participant tiles, bottom Zoom toolbar, top Zoom chrome with "Leave" button.`,
  ];

  if (input.prospectPhotoUrl) {
    promptParts.push(`CENTER PERSON: Replace the person at the desk with ${input.prospectName ?? "the prospect"} — accurately match their skin tone, hair color, hair style, and facial features. Keep the same seated-at-desk pose.`);
  }

  promptParts.push(
    `WHITEBOARD: Show "Top Roles Hiring:" header with these roles:\n${rolesText}`,
    input.companyLogoUrl
      ? `LOGO: Replace the "HERE" circle with the company logo.`
      : `LOGO: Keep the "HERE" circle as-is.`,
    `OUTPUT: Wide landscape image, 3:2 ratio. Bold cartoonish illustration style. Keep Zoom UI chrome exactly as-is.`,
  );

  const prompt = promptParts.join("\n");

  const images: File[] = [bufferToFile(referenceBuffer, "reference.png", "image/png")];

  if (input.prospectPhotoUrl) {
    const buf = await fetchImageBuffer(input.prospectPhotoUrl);
    if (buf) images.push(bufferToFile(buf, "prospect.png", "image/jpeg"));
  }

  if (input.teamPhotoUrls?.length) {
    const fetched = await Promise.all(input.teamPhotoUrls.slice(0, 4).map(fetchImageBuffer));
    fetched.forEach((buf, i) => {
      if (buf) images.push(bufferToFile(buf, `team${i}.png`, "image/jpeg"));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.images.edit as any)({
    model: "gpt-image-1",
    image: images,
    prompt,
    size: "1536x1024",
    quality: "high",
    output_format: "png",
    n: 1,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b64: string | undefined = (response as any).data?.[0]?.b64_json;
  if (!b64) throw new Error("No base64 image in gpt-image-1 edit response");
  return b64;
}
