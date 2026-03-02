import fs from 'fs';
import path from 'path';
import https from 'https';

export interface NanoBananaInput {
  /** Prospect's profile photo URL (the standing person to restyle) */
  prospectPhotoUrl: string;
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

/** Call Gemini image generation API */
async function callGeminiImageAPI(payload: object): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('GOOGLE_SEARCH_API_KEY not configured');

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

/**
 * Generates a War Room postcard background using Gemini Nano Banana 2.
 *
 * Sends the reference scene image + prospect headshot + team photos + screen.png
 * and asks the model to composite them into a single styled illustration.
 *
 * Returns base64-encoded PNG (no data: prefix).
 */
export async function generateNanaBananaWarRoom(input: NanoBananaInput): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');

  const templatesDir = path.join(process.cwd(), 'public', 'templates');

  // Load required local images
  const referenceImage = readLocalImageAsBase64(path.join(templatesDir, 'reference-pose.png'));
  const screenImage = readLocalImageAsBase64(path.join(templatesDir, 'screen.png'));

  if (!referenceImage) throw new Error('reference-pose.png not found in public/templates/');

  // Fetch prospect photo
  const prospectImage = await fetchImageAsBase64(input.prospectPhotoUrl);

  // Fetch team photos (up to 4, skip any that fail)
  const teamImages: Array<{ data: string; mimeType: string }> = [];
  if (input.teamPhotoUrls?.length) {
    const fetched = await Promise.all(
      input.teamPhotoUrls.slice(0, 4).map((url) => fetchImageAsBase64(url))
    );
    for (const img of fetched) {
      if (img) teamImages.push(img);
    }
  }

  // Fetch company logo (optional)
  const logoImage = input.companyLogoUrl ? await fetchImageAsBase64(input.companyLogoUrl) : null;

  // Build role list for whiteboard text
  const rolesText = input.openRoles?.length
    ? input.openRoles.slice(0, 3).map((r) => `• ${r.title} — ${r.location}`).join('\n')
    : '• Senior Engineer — Remote\n• Product Manager — NYC\n• Designer — SF';

  // Build the compositing prompt
  const promptLines = [
    `You are an expert digital illustrator. Recreate the reference scene (Image 1) EXACTLY — same layout, same positions, same furniture, same lighting — but with the specific face/character replacements described below.`,
    ``,
    `LAYOUT TO REPRODUCE EXACTLY (do not move anything):`,
    `- Far left: a tall whiteboard on wheels with text on it`,
    `- Center-left: a wooden conference table with people seated around it`,
    `- Center-back: ONE person standing upright near the head of the table, facing the others, holding a tablet`,
    `- Back wall right: a large wall-mounted screen/TV showing a dashboard`,
    `- Back wall right: a round wall clock / logo medallion`,
    `- Top right: a horizontal banner reading "IT'S GO TIME"`,
    `- Windows on the left wall showing a city skyline`,
    `- Industrial pendant lights hanging from the ceiling`,
    `- Keep EVERY element in EXACTLY the same position as Image 1`,
    ``,
    `FACE REPLACEMENTS ONLY (do not move anyone, just change their appearance):`,
    ``,
    `STANDING PERSON (Image 2): The ONE person standing near the head of the table — replace their face and appearance with the person in Image 2. You MUST accurately match their exact skin tone (light, medium, dark — whatever it is), hair color, hair texture, hair style, and facial features. This is critical — the skin color of the illustrated character must match the real person's skin color precisely. Keep the exact same standing pose and position. Render in the same cartoonish illustration style.`,
    ``,
    teamImages.length > 0
      ? `SEATED PEOPLE (Images 3–${2 + teamImages.length}): Replace the faces of the seated people around the table using these ${teamImages.length} reference photo(s), one per person. For each person, you MUST accurately match their exact skin tone, hair color, hair texture, and facial features — skin color matching is critical. Keep everyone in their exact same seated position. Render in the cartoonish style. If fewer photos than seats, leave remaining seated people as-is.`
      : `SEATED PEOPLE: Keep all seated people exactly as-is from the reference scene.`,
    ``,
    screenImage
      ? `SCREENS: Replace the content on ALL visible screens with the dashboard image provided — this includes: (1) the large wall-mounted TV/screen on the back wall, and (2) the laptop/monitor screen visible behind the standing person. Both screens should display the same dashboard content. All screens stay in their same positions.`
      : `SCREENS: Keep all screen content as-is from the reference scene.`,
    ``,
    logoImage
      ? `COMPANY LOGO: The reference scene contains the word "HERE" in multiple places (a round wall medallion and possibly other spots). Replace EVERY instance of the word "HERE" with the company logo image provided — place the logo in each of those exact spots. Do not add the logo anywhere else. Do not keep any "HERE" text.`
      : `COMPANY LOGO: Keep the "HERE" text/medallion areas exactly as-is from the reference scene.`,
    ``,
    `WHITEBOARD: The whiteboard on the far left must show the label "TOP ROLES" — written slightly larger and bolder than the items below it, just one size up, not a massive heading. Below it list these roles in handwritten style:`,
    rolesText,
    ``,
    `CRITICAL RULES:`,
    `- Output a WIDE HORIZONTAL landscape image — 3:2 ratio, roughly 1500×1000 pixels`,
    `- Do NOT move any objects, furniture, or people from their positions in Image 1`,
    `- Only change: faces of people, whiteboard text, wall screen content, logo medallion`,
    `- Keep the bold cartoonish illustration style throughout`,
    `- Keep "IT'S GO TIME" banner exactly as-is`,
    `- Do NOT add any extra text beyond what is specified`,
  ];

  const textPrompt = promptLines.join('\n');

  // Build content parts: text + images in order
  const parts: object[] = [{ text: textPrompt }];

  // Image 1: reference scene
  parts.push({ inline_data: { mime_type: referenceImage.mimeType, data: referenceImage.data } });

  // Image 2: prospect (standing person)
  if (prospectImage) {
    parts.push({ inline_data: { mime_type: prospectImage.mimeType, data: prospectImage.data } });
  }

  // Images 3–6: team members (seated)
  for (const img of teamImages) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  }

  // Screen image
  if (screenImage) {
    parts.push({ inline_data: { mime_type: screenImage.mimeType, data: screenImage.data } });
  }

  // Logo
  if (logoImage) {
    parts.push({ inline_data: { mime_type: logoImage.mimeType, data: logoImage.data } });
  }

  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      image_size: '2K',
    },
  };

  const base64 = await callGeminiImageAPI(payload);
  return base64;
}

/**
 * Generates a Zoom Room postcard background using Gemini Nano Banana 2.
 *
 * Reference scene: a person on a Zoom call at their desk. Replaces:
 * - Center person face → prospect photo
 * - "HERE" logo circle → company logo
 * - Monitor screen content → screen.png
 * - Left whiteboard roles → real open roles
 * - Right-side video call grid tiles → team photos (up to 4)
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
    const fetched = await Promise.all(
      input.teamPhotoUrls.slice(0, 4).map((url) => fetchImageAsBase64(url))
    );
    for (const img of fetched) {
      if (img) teamImages.push(img);
    }
  }

  const logoImage = input.companyLogoUrl ? await fetchImageAsBase64(input.companyLogoUrl) : null;

  const rolesText = input.openRoles?.length
    ? input.openRoles.slice(0, 3).map((r) => `• ${r.title} — ${r.location}`).join('\n')
    : '• Senior Engineer — Remote\n• Product Manager — Remote\n• Designer — Remote';

  const promptLines = [
    `You are an expert digital illustrator. Recreate the reference scene (Image 1) EXACTLY — same layout, same positions, same furniture, same lighting — but with only the specific changes described below.`,
    ``,
    `LAYOUT TO REPRODUCE EXACTLY (do not move anything):`,
    `- This is a Zoom video call screen — the entire image is a Zoom window`,
    `- Center: one person sitting at a desk, facing the camera, with a bookshelf behind them`,
    `- Top center: a round circle/logo that says "HERE"`,
    `- Left side: a whiteboard/sign panel with "Top Roles Hiring:" header and role list`,
    `- Right side: a vertical strip of 4 small video call participant tiles`,
    `- Bottom: Zoom UI toolbar (microphone, camera, share screen buttons)`,
    `- Top bar: Zoom window chrome with "Zoom" label and "Leave" button`,
    `- Keep EVERY element in EXACTLY the same position as Image 1`,
    ``,
    `FACE REPLACEMENTS ONLY (do not move anyone, just change their appearance):`,
    ``,
    prospectImage
      ? `CENTER PERSON (Image 2): Replace the face and appearance of the person sitting at the desk with the person in Image 2. You MUST accurately match their exact skin tone (light, medium, dark — whatever it is), hair color, hair texture, hair style, and facial features. Skin color matching is critical. Keep the same seated-at-desk pose. Render in the same cartoonish illustration style.`
      : `CENTER PERSON: Keep the center person exactly as-is from the reference scene.`,
    ``,
    teamImages.length > 0
      ? `VIDEO CALL TILES (Images ${prospectImage ? 3 : 2}–${(prospectImage ? 2 : 1) + teamImages.length}): Replace the ${teamImages.length} participant tile(s) on the right side of the screen with illustrated characters based on these reference photos. For each person, match their exact skin tone, hair color, and facial features. Keep the tile grid layout exactly as-is. If fewer photos than tiles, leave remaining tiles as-is.`
      : `VIDEO CALL TILES: Keep all participant tiles exactly as-is from the reference scene.`,
    ``,
    screenImage
      ? `MONITOR SCREEN: Replace the content on the monitor/laptop screen visible on the desk with the dashboard image provided (next image). The monitor stays in the same position.`
      : `MONITOR SCREEN: Keep the monitor screen content as-is.`,
    ``,
    logoImage
      ? `LOGO CIRCLE: Replace the "HERE" text in the round circle/logo (top center of the scene) with the company logo image provided. Same position, same size circle.`
      : `LOGO CIRCLE: Keep the "HERE" circle as-is.`,
    ``,
    `WHITEBOARD: The left-side panel must show "Top Roles Hiring:" at the top — slightly larger and bolder than the items, just one size up. Below it list these roles:`,
    rolesText,
    ``,
    `CRITICAL RULES:`,
    `- Output a WIDE HORIZONTAL landscape image — 3:2 ratio, roughly 1500×1000 pixels`,
    `- Do NOT move any objects, furniture, or people from their positions in Image 1`,
    `- Only change: center person face, participant tiles, monitor content, logo circle, whiteboard roles`,
    `- Keep the bold cartoonish illustration style throughout`,
    `- Keep the Zoom UI chrome (toolbar, top bar, "Leave" button) exactly as-is`,
    `- Do NOT add any extra text beyond what is specified`,
  ];

  const parts: object[] = [{ text: promptLines.join('\n') }];

  parts.push({ inline_data: { mime_type: referenceImage.mimeType, data: referenceImage.data } });

  if (prospectImage) {
    parts.push({ inline_data: { mime_type: prospectImage.mimeType, data: prospectImage.data } });
  }

  for (const img of teamImages) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } });
  }

  if (screenImage) {
    parts.push({ inline_data: { mime_type: screenImage.mimeType, data: screenImage.data } });
  }

  if (logoImage) {
    parts.push({ inline_data: { mime_type: logoImage.mimeType, data: logoImage.data } });
  }

  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      image_size: '2K',
    },
  };

  return await callGeminiImageAPI(payload);
}
