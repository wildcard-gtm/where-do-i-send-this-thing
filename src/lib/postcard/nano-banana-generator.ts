import fs from 'fs';
import path from 'path';
import https from 'https';

export interface NanoBananaInput {
  /** Prospect's profile photo URL (the standing person to restyle) — optional, keeps reference scene person if omitted */
  prospectPhotoUrl?: string | null;
  /** Company logo URL — placed on the wall */
  companyLogoUrl?: string | null;
  /** Up to 4 team member photo URLs — replace seated people */
  teamPhotoUrls?: string[];
  /** Top open roles to display on the whiteboard */
  openRoles?: Array<{ title: string; location: string }>;
  /** Prospect name for prompt context */
  prospectName?: string;
}

// Try Gemini-specific keys first, fall back to Google Search key
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_AI_STUDIO ||
  process.env.GOOGLE_SEARCH_API_KEY;
const MODEL = 'gemini-3.1-flash-image-preview'; // "Nano Banana 2" — confirmed via ListModels
const API_BASE = 'https://generativelanguage.googleapis.com';

/** Fetch a remote image URL and return base64 + mimeType */
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : require('http');

    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; postcard-bot/1.0)' },
      timeout: 15000,
    }, (res: any) => {
      // Follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        fetchImageAsBase64(res.headers.location).then(resolve);
        return;
      }
      if (res.statusCode !== 200) { resolve(null); return; }

      const contentType: string = res.headers['content-type'] ?? 'image/jpeg';
      const mimeType = contentType.split(';')[0].trim();

      // Gemini does not support SVG — skip placeholder avatars and SVG logos
      if (mimeType === 'image/svg+xml') { res.resume(); resolve(null); return; }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ data: buffer.toString('base64'), mimeType });
      });
      res.on('error', () => resolve(null));
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/** Read a local template file and return base64 */
function readLocalImageAsBase64(filePath: string): { data: string; mimeType: string } | null {
  try {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return { data: buffer.toString('base64'), mimeType };
  } catch {
    return null;
  }
}

/** Call Gemini image generation API with a base64 input image as context */
async function callGeminiImageAPI(payload: object): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');

  const body = JSON.stringify(payload);
  const urlPath = `/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Gemini API error: ${JSON.stringify(parsed.error)}`));
            return;
          }
          const parts: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }> =
            parsed.candidates?.[0]?.content?.parts ?? [];
          const imagePart = parts.find((p) => p.inlineData);
          if (!imagePart?.inlineData) {
            reject(new Error('No image in Gemini response. Parts: ' + JSON.stringify(parts.map(p => p.text ?? '[image]'))));
            return;
          }
          resolve(imagePart.inlineData.data); // base64 PNG
        } catch (e) {
          reject(new Error('Failed to parse Gemini response: ' + (e as Error).message));
        }
      });
    });

    req.on('error', (e) => reject(new Error('Gemini request failed: ' + e.message)));
    req.write(body);
    req.end();
  });
}

/** Run a single Gemini compositing stage. currentImage is the base64 scene to edit. */
async function runStage(currentImageBase64: string, prompt: string, extraImages: Array<{ data: string; mimeType: string }> = []): Promise<string> {
  const parts: object[] = [
    { text: prompt },
    { inline_data: { mime_type: 'image/png', data: currentImageBase64 } },
    ...extraImages.map(img => ({ inline_data: { mime_type: img.mimeType, data: img.data } })),
  ];

  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };

  return callGeminiImageAPI(payload);
}

// ─── Quality Enhancement Prompt ──────────────────────────────────────────────
// After multiple generative passes, images lose sharpness. This final pass
// restores crispness without altering content. The model re-renders at full
// fidelity since it only needs to preserve (not transform) the scene.

const QUALITY_ENHANCE_PROMPT = [
  `Enhance the quality of this image. Output the EXACT same image with these improvements:`,
  ``,
  `1. SHARPEN all edges — especially facial features, eyes, hairlines, text, and logos`,
  `2. RESTORE fine detail — skin texture, clothing folds, furniture grain, screen content`,
  `3. INCREASE contrast slightly — make colors more vibrant and blacks deeper`,
  `4. CLEAN UP any blurry or smudged areas — every element should look crisp and intentional`,
  ``,
  `CRITICAL RULES:`,
  `- Do NOT change any content, layout, composition, colors, or style`,
  `- Do NOT move, resize, add, or remove any element`,
  `- Do NOT alter faces, expressions, poses, or body positions`,
  `- Do NOT change any text — preserve every word exactly as-is`,
  `- The output must be pixel-for-pixel identical in CONTENT, just sharper and cleaner`,
  `- Think of this as a "remaster" — same image, higher fidelity`,
].join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// WAR ROOM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a War Room postcard background using staged Gemini compositing.
 *
 * Stage 1: Replace whiteboard text with real open roles
 * Stage 2 (if logo): Replace the round "HERE" wall medallion with company logo
 * Stage 3: Replace wall screen + laptop screen content with dashboard image
 * Stage 4 (if photos): Replace faces — standing person → prospect, seated → team (LAST to preserve quality)
 * Stage 5: Quality enhancement — sharpen and restore detail lost from multiple model passes
 *
 * Each stage receives the output of the previous as its input image.
 * If a stage fails, the pipeline continues with the previous stage's output.
 *
 * Returns base64-encoded PNG (no data: prefix).
 */
export async function generateNanaBananaWarRoom(input: NanoBananaInput): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');

  const templatesDir = path.join(process.cwd(), 'public', 'templates');
  const referenceImage = readLocalImageAsBase64(path.join(templatesDir, 'reference-pose.png'));
  const screenImage = readLocalImageAsBase64(path.join(templatesDir, 'screen.png'));

  if (!referenceImage) throw new Error('reference-pose.png not found in public/templates/');

  // Fetch prospect photo
  const prospectImage = input.prospectPhotoUrl ? await fetchImageAsBase64(input.prospectPhotoUrl) : null;

  // Fetch team photos (up to 4)
  const teamImages: Array<{ data: string; mimeType: string }> = [];
  if (input.teamPhotoUrls?.length) {
    const fetched = await Promise.all(input.teamPhotoUrls.slice(0, 4).map(url => fetchImageAsBase64(url)));
    for (const img of fetched) { if (img) teamImages.push(img); }
  }

  // Fetch company logo
  const logoImage = input.companyLogoUrl ? await fetchImageAsBase64(input.companyLogoUrl) : null;

  // Build role list — short titles only, max 3
  const rolesText = input.openRoles?.length
    ? input.openRoles.slice(0, 3).map(r => {
        // Truncate long titles to keep whiteboard readable
        const title = r.title.length > 35 ? r.title.slice(0, 33) + '…' : r.title;
        return `• ${title}`;
      }).join('\n')
    : '• Software Engineer\n• Product Manager\n• Data Analyst';

  // Start with the reference image
  let current = referenceImage.data;

  // ── Stage 1: Whiteboard text ─────────────────────────────────────────────
  const boardPrompt = [
    `This is a cartoonish illustrated conference room scene. Your ONLY task is to update the whiteboard text — do NOT change anything else (no people, no furniture, no screens, no logo, no banner).`,
    ``,
    `WHITEBOARD (far left of the image, tall board on wheels):`,
    `- The header must read exactly: "TOP ROLES" — bold, clear, fully visible, not cut off`,
    `- Below the header, list these roles in clean handwritten style, each on its own line:`,
    rolesText,
    `- The text must be clearly legible. Do not let any text run off the edges of the whiteboard.`,
    `- Keep the same whiteboard position, size, and color as in the current image.`,
    ``,
    `CRITICAL: Change ONLY the whiteboard text. Do not touch people, faces, screens, logo, banner, table, or any other element.`,
  ].join('\n');

  try {
    current = await runStage(current, boardPrompt);
  } catch (e) {
    console.error('War Room Stage 1 (whiteboard) failed, continuing:', (e as Error).message);
  }

  // ── Stage 2: Logo (only if we have one) ──────────────────────────────────
  if (logoImage) {
    const logoPrompt = [
      `This is a cartoonish illustrated conference room scene. Your ONLY task is to replace the round circular wall medallion/clock on the back wall with the company logo shown in Image 2 — do NOT change anything else.`,
      ``,
      `LOGO MEDALLION: On the back-right wall there is a round circular element (currently showing "HERE" text or a clock shape). Replace the entire content of that circle with the company logo from Image 2. Keep the circle in exactly the same position and same size on the wall. The logo should fill the circle cleanly.`,
      ``,
      `CRITICAL: Change ONLY the round wall medallion. Do not touch people, whiteboard, screens, banner, furniture, or any other element.`,
    ].join('\n');

    try {
      current = await runStage(current, logoPrompt, [logoImage]);
    } catch (e) {
      console.error('War Room Stage 2 (logo) failed, continuing:', (e as Error).message);
    }
  }

  // ── Stage 3: Screen content ───────────────────────────────────────────────
  if (screenImage) {
    const screenPrompt = [
      `This is a cartoonish illustrated conference room scene. Your ONLY task is to replace the content shown on the screens — do NOT change anything else (no people, no whiteboard, no logo, no furniture).`,
      ``,
      `SCREENS: There are two screens visible in the scene:`,
      `1. The large wall-mounted TV/monitor on the back-right wall`,
      `2. The laptop or monitor screen visible on or near the table`,
      `Replace the content displayed on BOTH screens with the dashboard image shown in Image 2. The screens stay in their exact same positions — only their displayed content changes.`,
      ``,
      `CRITICAL: Change ONLY what is shown on the screens. Do not touch people, whiteboard text, logo medallion, banner, or furniture.`,
    ].join('\n');

    try {
      current = await runStage(current, screenPrompt, [screenImage]);
    } catch (e) {
      console.error('War Room Stage 3 (screens) failed, continuing:', (e as Error).message);
    }
  }

  // ── Stage 4: Faces LAST (only if we have at least one photo) ─────────────
  // Faces go last so they pass through the fewest model iterations, preserving
  // maximum fidelity on the most important visual element.
  const hasPhotos = prospectImage || teamImages.length > 0;
  if (hasPhotos) {
    const faceExtras: Array<{ data: string; mimeType: string }> = [];
    if (prospectImage) faceExtras.push(prospectImage);
    for (const img of teamImages) faceExtras.push(img);

    const facePrompt = [
      `This is a cartoonish illustrated conference room scene. Your ONLY task is to replace the faces and appearance of people — do NOT change anything else in the image (no furniture, no text, no backgrounds, no colors, no layout).`,
      ``,
      prospectImage
        ? `STANDING PERSON: The ONE person standing near the head of the table — replace their face and appearance with the person shown in Image 2. Match their exact skin tone, hair color, hair style, and facial features precisely. IMPORTANT: Also update the skin tone on ALL visible body parts (neck, hands, arms) to match the reference photo — the entire person should look consistent, not just the face. Keep the same standing pose. Render in the same cartoonish style as the rest of the image.`
        : `STANDING PERSON: Keep exactly as-is.`,
      ``,
      teamImages.length > 0
        ? `SEATED PEOPLE: Replace the faces of the ${teamImages.length} seated person(s) around the table using Image${faceExtras.length > 1 ? `s ${prospectImage ? 3 : 2}–${(prospectImage ? 2 : 1) + teamImages.length}` : ` ${prospectImage ? 3 : 2}`} as references, one photo per person. Match each person's exact skin tone, hair, and facial features. IMPORTANT: Also update the skin tone on ALL visible body parts (neck, hands, arms) to match each reference photo. Keep all seated positions exactly the same.`
        : `SEATED PEOPLE: Keep all seated people exactly as-is.`,
      ``,
      `CRITICAL: Change ONLY the faces/appearances of people and their visible skin. Do not touch the whiteboard, text, screens, logo, banner, furniture, or background.`,
    ].join('\n');

    try {
      current = await runStage(current, facePrompt, faceExtras);
    } catch (e) {
      console.error('War Room Stage 4 (faces) failed, continuing:', (e as Error).message);
    }
  }

  // ── Stage 5: Quality enhancement ─────────────────────────────────────────
  // After multiple model passes, the image loses sharpness. This final pass
  // restores clarity without altering any content.
  try {
    current = await runStage(current, QUALITY_ENHANCE_PROMPT);
  } catch (e) {
    console.error('War Room Stage 5 (quality) failed, using previous output:', (e as Error).message);
  }

  return current;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZOOM ROOM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a Zoom Room postcard background using staged Gemini compositing.
 *
 * Stage 1: Replace left whiteboard roles text
 * Stage 2 (if logo): Replace round "HERE" circle with company logo
 * Stage 3: Replace monitor screen content with dashboard image
 * Stage 4 (if photos): Replace center person face → prospect, tile faces → team (LAST to preserve quality)
 * Stage 5: Quality enhancement — sharpen and restore detail
 *
 * Returns base64-encoded PNG (no data: prefix).
 */
export async function generateNanaBananaZoomRoom(input: NanoBananaInput): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');

  const templatesDir = path.join(process.cwd(), 'public', 'templates');
  const referenceImage = readLocalImageAsBase64(path.join(templatesDir, 'zoom-room-reference.png'));
  const screenImage = readLocalImageAsBase64(path.join(templatesDir, 'screen.png'));

  if (!referenceImage) throw new Error('zoom-room-reference.png not found in public/templates/');

  const prospectImage = input.prospectPhotoUrl ? await fetchImageAsBase64(input.prospectPhotoUrl) : null;

  const teamImages: Array<{ data: string; mimeType: string }> = [];
  if (input.teamPhotoUrls?.length) {
    const fetched = await Promise.all(input.teamPhotoUrls.slice(0, 4).map(url => fetchImageAsBase64(url)));
    for (const img of fetched) { if (img) teamImages.push(img); }
  }

  const logoImage = input.companyLogoUrl ? await fetchImageAsBase64(input.companyLogoUrl) : null;

  const rolesText = input.openRoles?.length
    ? input.openRoles.slice(0, 3).map(r => {
        const title = r.title.length > 35 ? r.title.slice(0, 33) + '…' : r.title;
        return `• ${title}`;
      }).join('\n')
    : '• Software Engineer\n• Product Manager\n• Data Analyst';

  let current = referenceImage.data;

  // ── Stage 1: Whiteboard roles ─────────────────────────────────────────────
  const boardPrompt = [
    `This is a cartoonish illustrated Zoom video call scene. Your ONLY task is to update the text on the left-side whiteboard/panel — do NOT change anything else.`,
    ``,
    `LEFT PANEL (whiteboard on the left side of the screen):`,
    `- The header must read exactly: "Top Roles Hiring:" — bold, clear, fully visible`,
    `- Below the header, list these roles in clean style, each on its own line:`,
    rolesText,
    `- All text must be clearly legible and fully contained within the panel. Do not let text run off the edges.`,
    `- Keep the panel in exactly the same position and size.`,
    ``,
    `CRITICAL: Change ONLY the left panel text. Do not touch people, faces, logo circle, monitor screen, Zoom toolbar, or any other element.`,
  ].join('\n');

  try {
    current = await runStage(current, boardPrompt);
  } catch (e) {
    console.error('Zoom Room Stage 1 (whiteboard) failed, continuing:', (e as Error).message);
  }

  // ── Stage 2: Logo ─────────────────────────────────────────────────────────
  if (logoImage) {
    const logoPrompt = [
      `This is a cartoonish illustrated Zoom video call scene. Your ONLY task is to replace the round circle at the top-center of the screen with the company logo shown in Image 2 — do NOT change anything else.`,
      ``,
      `LOGO CIRCLE: At the top-center of the Zoom screen there is a round circle currently showing "HERE" text. Replace the content inside that circle with the company logo from Image 2. Keep the circle in exactly the same position and size. The logo should fill the circle cleanly.`,
      ``,
      `CRITICAL: Change ONLY the top-center circle. Do not touch people, whiteboard panel, monitor screen, Zoom toolbar, or any other element.`,
    ].join('\n');

    try {
      current = await runStage(current, logoPrompt, [logoImage]);
    } catch (e) {
      console.error('Zoom Room Stage 2 (logo) failed, continuing:', (e as Error).message);
    }
  }

  // ── Stage 3: Monitor screen ───────────────────────────────────────────────
  if (screenImage) {
    const screenPrompt = [
      `This is a cartoonish illustrated Zoom video call scene. Your ONLY task is to replace the content shown on the monitor/laptop screen on the desk — do NOT change anything else.`,
      ``,
      `MONITOR SCREEN: The person at the desk has a monitor/laptop screen visible. Replace what is displayed on that screen with the dashboard image shown in Image 2. The monitor stays in the exact same position — only its displayed content changes.`,
      ``,
      `CRITICAL: Change ONLY the monitor screen content. Do not touch people, whiteboard panel, logo circle, Zoom toolbar, video tiles, or any other element.`,
    ].join('\n');

    try {
      current = await runStage(current, screenPrompt, [screenImage]);
    } catch (e) {
      console.error('Zoom Room Stage 3 (screen) failed, continuing:', (e as Error).message);
    }
  }

  // ── Stage 4: Faces LAST (only if we have at least one photo) ─────────────
  const hasPhotos = prospectImage || teamImages.length > 0;
  if (hasPhotos) {
    const faceExtras: Array<{ data: string; mimeType: string }> = [];
    if (prospectImage) faceExtras.push(prospectImage);
    for (const img of teamImages) faceExtras.push(img);

    const facePrompt = [
      `This is a cartoonish illustrated Zoom video call scene. Your ONLY task is to replace the faces and appearance of people — do NOT change anything else (no text, no layout, no UI, no backgrounds).`,
      ``,
      prospectImage
        ? `CENTER PERSON: The person sitting at the desk in the center of the screen — replace their face and appearance with the person shown in Image 2. Match their exact skin tone, hair color, hair style, and facial features. IMPORTANT: Also update the skin tone on ALL visible body parts (neck, hands, arms) to match the reference photo — the entire person should look consistent, not just the face. Keep the same seated-at-desk pose. Render in the same cartoonish style.`
        : `CENTER PERSON: Keep exactly as-is.`,
      ``,
      teamImages.length > 0
        ? `VIDEO TILES: Replace the participant faces in the ${teamImages.length} right-side video call tile(s) using Image${faceExtras.length > 1 ? `s ${prospectImage ? 3 : 2}–${(prospectImage ? 2 : 1) + teamImages.length}` : ` ${prospectImage ? 3 : 2}`}. Match each person's skin tone, hair, and facial features. IMPORTANT: Also update visible skin tone on neck/hands to match each reference photo. Keep the tile grid layout exactly as-is.`
        : `VIDEO TILES: Keep all participant tiles exactly as-is.`,
      ``,
      `CRITICAL: Change ONLY faces/appearances of people and their visible skin. Do not touch the whiteboard panel, logo circle, monitor screen, Zoom UI toolbar, or any text.`,
    ].join('\n');

    try {
      current = await runStage(current, facePrompt, faceExtras);
    } catch (e) {
      console.error('Zoom Room Stage 4 (faces) failed, continuing:', (e as Error).message);
    }
  }

  // ── Stage 5: Quality enhancement ─────────────────────────────────────────
  try {
    current = await runStage(current, QUALITY_ENHANCE_PROMPT);
  } catch (e) {
    console.error('Zoom Room Stage 5 (quality) failed, using previous output:', (e as Error).message);
  }

  return current;
}
