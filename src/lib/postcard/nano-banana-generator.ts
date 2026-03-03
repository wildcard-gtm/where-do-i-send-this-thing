/**
 * Nano Banana Agentic Postcard Generator
 *
 * Uses an agentic loop to generate postcard scenes:
 * 1. Send reference template + all input images in a single pass
 * 2. Analyze the output against the reference and input images
 * 3. If issues found, regenerate with descriptive corrections
 * 4. Repeat until the analysis passes (max 4 attempts)
 *
 * Uses Gemini for generation (IMAGE modality) and analysis (TEXT modality).
 * Returns base64-encoded PNG (no data: prefix).
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import { getGeminiModel } from '@/lib/ai/config';

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
  /** User's additional instructions for the AI generator */
  customPrompt?: string | null;
}

type ImageData = { data: string; mimeType: string };

// Try Gemini-specific keys first, fall back to Google Search key
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_AI_STUDIO ||
  process.env.GOOGLE_SEARCH_API_KEY;
// Models loaded from DB at runtime via getGeminiModel() — configured in Admin → Models tab
const MAX_ATTEMPTS = 4;

// ─── Gemini API ─────────────────────────────────────────────────────────────

function callGemini(
  model: string,
  payload: object,
): Promise<{ image?: string; text?: string }> {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');

  const body = JSON.stringify(payload);
  const urlPath = `/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

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
          const textParts = parts.filter((p) => p.text).map((p) => p.text!).join('\n');
          resolve({
            image: imagePart?.inlineData?.data,
            text: textParts || undefined,
          });
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

/** Generate an image from a prompt + input images */
async function generateImage(prompt: string, images: ImageData[]): Promise<string> {
  const imageModel = await getGeminiModel('image_gen');
  const parts: object[] = [
    { text: prompt },
    ...images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } })),
  ];

  const result = await callGemini(imageModel, {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });

  if (!result.image) throw new Error('No image in Gemini response');
  return result.image;
}

/** Analyze an image with text — returns text analysis */
async function analyzeImage(prompt: string, images: ImageData[]): Promise<string> {
  const analysisModel = await getGeminiModel('image_analysis');
  const parts: object[] = [
    { text: prompt },
    ...images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } })),
  ];

  const result = await callGemini(analysisModel, {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['TEXT'] },
  });

  return result.text ?? '(no analysis returned)';
}

// ─── Image Fetching ─────────────────────────────────────────────────────────

/** Fetch a remote image URL and return base64 + mimeType */
async function fetchImageAsBase64(url: string): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : require('http');

    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; postcard-bot/1.0)' },
      timeout: 15000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
function readLocalImageAsBase64(filePath: string): ImageData | null {
  try {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return { data: buffer.toString('base64'), mimeType };
  } catch {
    return null;
  }
}

// ─── Analysis Helpers ───────────────────────────────────────────────────────

/** Parse issues from analysis text */
function parseIssues(analysis: string): { pass: boolean; issues: string[] } {
  const overallMatch = analysis.match(/OVERALL:\s*(PASS|FAIL)/i);
  const pass = overallMatch?.[1]?.toUpperCase() === 'PASS';

  const issues: string[] = [];
  const issuesSection = analysis.split(/ISSUES:/i)[1];
  if (issuesSection) {
    const lines = issuesSection.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      const cleaned = line.replace(/^\s*\d+[\.\)]\s*/, '').replace(/^\*+\s*/, '').trim();
      if (cleaned && cleaned !== 'None' && cleaned !== 'N/A' && cleaned !== '(none)' && cleaned !== '(None)' && cleaned.length > 5) {
        issues.push(cleaned);
      }
    }
  }

  return { pass, issues };
}

// ─── Title Normalization ─────────────────────────────────────────────────────

/** Normalize a job title to be short, clean, and easy for AI to render without spelling errors */
export function normalizeJobTitle(title: string): string {
  let t = title.trim();

  // Strip location/level suffixes after commas, dashes, pipes, parens
  // Order matters: "City, ST" must run before bare trailing state codes
  t = t.replace(/\s*[,|–—]\s*(Remote|Hybrid|On-?site|Onsite).*$/i, '');
  t = t.replace(/\s*[,|–—]\s*([\w\s]+,\s*[A-Z]{2})$/i, ''); // "City, ST" suffix
  t = t.replace(/\s*[,|–—]\s*[A-Z]{2}\s*$/i, ''); // trailing state codes
  t = t.replace(/\s*\(.*?\)\s*/g, ''); // parenthetical info

  // Abbreviate common terms
  const abbrevs: [RegExp, string][] = [
    [/\bSenior\b/gi, 'Sr.'],
    [/\bJunior\b/gi, 'Jr.'],
    [/\bVice President\b/gi, 'VP'],
    [/\bSenior Vice President\b/gi, 'SVP'],
    [/\bExecutive Vice President\b/gi, 'EVP'],
    [/\bManaging Director\b/gi, 'MD'],
    [/\bChief Technology Officer\b/gi, 'CTO'],
    [/\bChief Executive Officer\b/gi, 'CEO'],
    [/\bChief Financial Officer\b/gi, 'CFO'],
    [/\bChief Operating Officer\b/gi, 'COO'],
    [/\bChief Marketing Officer\b/gi, 'CMO'],
    [/\bChief Product Officer\b/gi, 'CPO'],
    [/\bChief Revenue Officer\b/gi, 'CRO'],
    [/\bChief Information Officer\b/gi, 'CIO'],
    [/\bSoftware Engineer\b/gi, 'SW Engineer'],
    [/\bSoftware Development Engineer\b/gi, 'SDE'],
    [/\bMachine Learning\b/gi, 'ML'],
    [/\bArtificial Intelligence\b/gi, 'AI'],
    [/\bEngineering Manager\b/gi, 'Eng Manager'],
    [/\bProduct Manager\b/gi, 'Product Manager'],
    [/\bPrincipal\b/gi, 'Principal'],
    [/\bDistinguished\b/gi, 'Dist.'],
    [/\bDepartment\b/gi, 'Dept.'],
    [/\bAssociate\b/gi, 'Assoc.'],
    [/\bAssistant\b/gi, 'Asst.'],
    [/\bAdministrat(or|ion)\b/gi, 'Admin'],
    [/\bDevelopment\b/gi, 'Dev'],
    [/\bEngineering\b/gi, 'Eng'],
    [/\bManagement\b/gi, 'Mgmt'],
    [/\bOperations\b/gi, 'Ops'],
    [/\bInfrastructure\b/gi, 'Infra'],
    [/\bArchitecture\b/gi, 'Architecture'],
    [/\bTechnolog(y|ies)\b/gi, 'Tech'],
    [/\bInformation\b/gi, 'Info'],
  ];

  for (const [pattern, replacement] of abbrevs) {
    t = t.replace(pattern, replacement);
  }

  // Clean up double spaces
  t = t.replace(/\s+/g, ' ').trim();

  // Hard cap at 25 chars
  if (t.length > 25) {
    t = t.slice(0, 23) + '...';
  }

  return t;
}

// ─── Data Loading ───────────────────────────────────────────────────────────

interface PreparedData {
  reference: ImageData;
  screen: ImageData | null;
  prospectImage: ImageData | null;
  logoImage: ImageData | null;
  teamImages: ImageData[];
  rolesText: string;
  customPrompt?: string | null;
}

async function prepareWarRoomData(input: NanoBananaInput): Promise<PreparedData> {
  const templatesDir = path.join(process.cwd(), 'public', 'templates');
  const reference = readLocalImageAsBase64(path.join(templatesDir, 'reference-pose.png'));
  const screen = readLocalImageAsBase64(path.join(templatesDir, 'screen.png'));
  if (!reference) throw new Error('reference-pose.png not found in public/templates/');

  const [prospectImage, logoImage] = await Promise.all([
    input.prospectPhotoUrl ? fetchImageAsBase64(input.prospectPhotoUrl) : null,
    input.companyLogoUrl ? fetchImageAsBase64(input.companyLogoUrl) : null,
  ]);

  const teamImages: ImageData[] = [];
  if (input.teamPhotoUrls?.length) {
    const fetched = await Promise.all(input.teamPhotoUrls.slice(0, 5).map(url => fetchImageAsBase64(url)));
    for (const img of fetched) { if (img) teamImages.push(img); }
  }

  const rolesText = input.openRoles?.length
    ? input.openRoles.slice(0, 3).map(r => `  \u2022 ${normalizeJobTitle(r.title)}`).join('\n')
    : '  \u2022 SW Engineer\n  \u2022 Product Manager\n  \u2022 Data Analyst';

  return { reference, screen, prospectImage, logoImage, teamImages, rolesText, customPrompt: input.customPrompt };
}

async function prepareZoomRoomData(input: NanoBananaInput): Promise<PreparedData> {
  const templatesDir = path.join(process.cwd(), 'public', 'templates');
  const reference = readLocalImageAsBase64(path.join(templatesDir, 'zoom-room-reference.png'));
  const screen = readLocalImageAsBase64(path.join(templatesDir, 'screen.png'));
  if (!reference) throw new Error('zoom-room-reference.png not found in public/templates/');

  const [prospectImage, logoImage] = await Promise.all([
    input.prospectPhotoUrl ? fetchImageAsBase64(input.prospectPhotoUrl) : null,
    input.companyLogoUrl ? fetchImageAsBase64(input.companyLogoUrl) : null,
  ]);

  const teamImages: ImageData[] = [];
  if (input.teamPhotoUrls?.length) {
    const fetched = await Promise.all(input.teamPhotoUrls.slice(0, 4).map(url => fetchImageAsBase64(url)));
    for (const img of fetched) { if (img) teamImages.push(img); }
  }

  const rolesText = input.openRoles?.length
    ? input.openRoles.slice(0, 3).map(r => `  \u2022 ${normalizeJobTitle(r.title)}`).join('\n')
    : '  \u2022 SW Engineer\n  \u2022 Product Manager\n  \u2022 Data Analyst';

  return { reference, screen, prospectImage, logoImage, teamImages, rolesText, customPrompt: input.customPrompt };
}

// ─── War Room Prompts ───────────────────────────────────────────────────────

function buildWarRoomGenerationPrompt(data: PreparedData, previousIssues?: string[]): string {
  // Build image label list — maps each provided image to its labeled slot in the reference
  const imageLabels: string[] = ['Image 1 = reference template (follow this layout EXACTLY — it has labeled placeholder slots)'];
  let imgIdx = 2;
  if (data.logoImage) { imageLabels.push(`Image ${imgIdx} = company logo → replaces [COMPANY LOGO] slot`); imgIdx++; }
  if (data.prospectImage) { imageLabels.push(`Image ${imgIdx} = prospect face photo → replaces "Person 1" (standing presenter)`); imgIdx++; }
  for (let i = 0; i < data.teamImages.length; i++) {
    imageLabels.push(`Image ${imgIdx} = team member ${i + 1} face photo → replaces "Person ${i + 2}" (seated)`);
    imgIdx++;
  }
  if (data.screen) imageLabels.push(`Image ${imgIdx} = dashboard screenshot → replaces screen content`);

  const corrections = previousIssues?.length
    ? [
        '',
        'CRITICAL CORRECTIONS FROM PREVIOUS ATTEMPT (you MUST fix these):',
        ...previousIssues.map((issue, i) => `  ${i + 1}. ${issue}`),
        '',
      ].join('\n')
    : '';

  // Build people instructions — only slots with a provided photo get filled, all others are removed
  const personSlots: string[] = [];
  const removedSlots: string[] = [];

  if (data.prospectImage) {
    personSlots.push(
      `   - "Person 1" (standing presenter): Use the prospect face photo.`,
      `     Preserve their facial features (hair, skin tone, facial structure, glasses, facial hair).`,
      `     Match gender — adapt body build, clothing, and footwear to the prospect's apparent gender.`,
      `     Render in illustration style, not photorealistic. Keep the standing pose.`,
    );
  } else {
    removedSlots.push('"Person 1"');
  }

  for (let i = 0; i < 5; i++) {
    if (i < data.teamImages.length) {
      personSlots.push(
        `   - "Person ${i + 2}" (seated): Use team member ${i + 1} face photo.`,
        `     Preserve their facial features, render in illustration style. Keep the seated pose.`,
      );
    } else {
      removedSlots.push(`"Person ${i + 2}"`);
    }
  }

  return [
    `The reference template (Image 1) shows a War Room scene with labeled placeholder slots.`,
    `Reproduce this scene EXACTLY, filling in the labeled slots with the provided images. Output a single wide landscape image.`,
    ``,
    `IMAGE LABELS:`,
    ...imageLabels.map((l) => `  ${l}`),
    ``,
    `STYLE: Bold flat-color corporate illustration — clean outlines, vibrant colors, Pixar-inspired 2D. Every element including all people must match this style consistently. No photorealistic faces.`,
    ``,
    `The reference template already defines the room layout, furniture, lighting, windows, banner, plants, etc. Keep ALL of that exactly as shown. Only fill in the labeled placeholder slots:`,
    ``,
    `1. [TOP ROLES] whiteboard:`,
    `   Replace the placeholder text with:`,
    `   - Header: "TOP ROLES" in bold`,
    `   - Roles listed below in clean handwritten style:`,
    data.rolesText,
    `   - Write ONLY these roles. No filler text. If fewer than 3, leave remaining space blank.`,
    `   - Text must be legible and within the whiteboard bounds.`,
    ``,
    data.logoImage
      ? [
          `2. [COMPANY LOGO] circle on the wall:`,
          `   Replace with the provided company logo. Same position, same size.`,
          `   The logo must appear EXACTLY ONCE in the entire image.`,
        ].join('\n')
      : `2. [COMPANY LOGO]: No logo provided — draw a generic decorative circle.`,
    ``,
    `3. SCREENS: Replace screen content with the provided dashboard screenshot.`,
    ``,
    personSlots.length > 0
      ? [
          `4. PEOPLE — The reference has labeled silhouettes (Person 1 through Person 6). Fill in ONLY the ones with provided photos:`,
          ...personSlots,
          removedSlots.length > 0
            ? `   - REMOVE these (no photo provided): ${removedSlots.join(', ')}. Delete them from the scene entirely — leave their chair/seat empty, do NOT draw any character there.`
            : '',
          `   - ALL people rendered in the same illustration style. Use photos ONLY for facial features.`,
        ].filter(Boolean).join('\n')
      : [
          `4. PEOPLE — The reference has labeled silhouettes.`,
          `   REMOVE ALL of them (${removedSlots.join(', ')}) — no photos were provided.`,
          `   Leave all chairs/seats empty. No people in the final image.`,
        ].join('\n'),
    corrections,
    ``,
    `FINAL CHECKS:`,
    `- Logo appears EXACTLY ONCE`,
    `- All text legible and within bounds`,
    `- Wide landscape output (3:2), not square or portrait`,
    `- No gray silhouettes remain — only people with provided photos appear, rest are removed`,
    `- Consistent illustration style — no photorealistic elements`,
    data.customPrompt ? `\nADDITIONAL USER INSTRUCTIONS (follow these carefully):\n${data.customPrompt}` : '',
  ].filter(Boolean).join('\n');
}

function buildWarRoomAnalysisPrompt(data: PreparedData): string {
  const expectedRoles = data.rolesText.replace(/  \u2022 /g, '').split('\n').join(', ');

  const labels: string[] = [
    'Image 1 = reference template (has labeled placeholder slots — the LAYOUT to preserve)',
    'Image 2 = generated output (the image being reviewed)',
  ];
  let idx = 3;
  if (data.logoImage) { labels.push(`Image ${idx} = company logo (should replace [COMPANY LOGO] slot, appear ONCE)`); idx++; }
  if (data.prospectImage) { labels.push(`Image ${idx} = prospect face photo (should replace "Person 1" — the standing presenter)`); idx++; }
  for (let i = 0; i < data.teamImages.length; i++) {
    labels.push(`Image ${idx} = team member ${i + 1} face photo (should replace "Person ${i + 2}")`);
    idx++;
  }

  return [
    `You are reviewing a generated War Room postcard. The reference template (Image 1) has labeled placeholder slots. We asked the AI to fill them in. Verify it was done correctly.`,
    ``,
    `IMAGES PROVIDED:`,
    ...labels.map((l) => `  ${l}`),
    ``,
    `WHAT WE ASKED:`,
    `- Fill [TOP ROLES] whiteboard with: ${expectedRoles}`,
    data.logoImage ? `- Fill [COMPANY LOGO] with the provided company logo (once only)` : `- No logo provided — should be a generic decorative circle`,
    `- Fill screens with the dashboard screenshot`,
    data.prospectImage ? `- Replace "Person 1" (standing) with the prospect's facial features — intentional, should NOT match the gray silhouette` : ``,
    data.teamImages.length > 0 ? `- Replace "Person 2"–"Person ${data.teamImages.length + 1}" with team member faces` : ``,
    `- All remaining silhouettes (without photos) should be REMOVED — empty chairs, no people drawn there`,
    ``,
    `TARGET STYLE: Flat-color corporate illustration — clean outlines, vibrant colors, Pixar-inspired 2D. No photorealistic faces.`,
    ``,
    `EVALUATE Image 2:`,
    ``,
    `1. LAYOUT: Does Image 2 preserve the room layout from Image 1?`,
    `2. WHITEBOARD: Shows "TOP ROLES" with exactly: ${expectedRoles}? Check SPELLING letter by letter. FAIL if misspelled or if filler text appears (e.g. "more roles coming soon"). Only the listed roles should appear.`,
    data.logoImage
      ? `3. LOGO: Company logo appears EXACTLY ONCE at the [COMPANY LOGO] position? Not duplicated elsewhere?`
      : `3. LOGO: N/A`,
    `4. SCREENS: Show dashboard content?`,
    data.prospectImage
      ? [
          `5. PERSON 1 (STANDING) — CRITICAL CHECK:`,
          `   Must match the prospect photo: hair color/style, skin tone, gender, glasses, facial hair.`,
          `   Body build and clothing must match prospect's apparent gender.`,
          `   FAIL if Person 1 still looks like a gray silhouette or doesn't match the prospect photo.`,
          `   This is the MOST IMPORTANT check.`,
        ].join('\n')
      : `5. PERSON 1: N/A (no prospect photo provided)`,
    data.teamImages.length > 0
      ? `6. PERSONS 2–${data.teamImages.length + 1} (SEATED): Do they match the ${data.teamImages.length} team member photo(s)? All in illustration style?`
      : `6. TEAM: N/A`,
    `7. SILHOUETTES: Are all unprovided person slots REMOVED (empty chairs)? FAIL if any gray silhouettes remain.`,
    `8. STYLE: Consistent illustration style on ALL faces — flat colors, clean outlines, no photorealistic faces?`,
    `9. FORMAT: Wide landscape (3:2)?`,
    ``,
    `For each: PASS or FAIL with brief reason.`,
    `OVERALL: PASS or FAIL`,
    `ISSUES: Numbered actionable fixes (empty if PASS).`,
    ``,
    `RULE FOR ISSUES: The generator cannot see image numbers. Use VISUAL DESCRIPTIONS only:`,
    `BAD: "Make Person 1 look like Image 4"`,
    `GOOD: "Person 1 (standing) should be a [gender] with [skin tone], [hair], [glasses]. Currently looks like [problem]."`,
    `For spelling: "Whiteboard says '[wrong]' but should say '[correct]'."`,
  ].filter(Boolean).join('\n');
}

// ─── Zoom Room Prompts ──────────────────────────────────────────────────────

function buildZoomRoomGenerationPrompt(data: PreparedData, previousIssues?: string[]): string {
  const imageLabels: string[] = ['Image 1 = reference Zoom scene (reproduce EXACTLY)'];
  let imgIdx = 2;
  if (data.logoImage) { imageLabels.push(`Image ${imgIdx} = company logo`); imgIdx++; }
  if (data.prospectImage) { imageLabels.push(`Image ${imgIdx} = prospect face photo`); imgIdx++; }
  for (let i = 0; i < data.teamImages.length; i++) { imageLabels.push(`Image ${imgIdx} = team member ${i + 1}`); imgIdx++; }
  if (data.screen) imageLabels.push(`Image ${imgIdx} = dashboard for monitor screen`);

  const corrections = previousIssues?.length
    ? '\nCRITICAL FIXES FROM PREVIOUS ATTEMPT:\n' + previousIssues.map((issue, i) => `  ${i + 1}. ${issue}`).join('\n') + '\n'
    : '';

  return [
    `Recreate the reference Zoom call scene (Image 1) with specific modifications. Output a single image.`,
    ``,
    `IMAGE LABELS:`,
    ...imageLabels.map((l) => `  ${l}`),
    ``,
    `STYLE: Warm-toned flat-color corporate illustration with clean outlines — Pixar-inspired 2D style. Every element must match this style consistently.`,
    ``,
    `PRESERVE EXACTLY (do NOT change these):`,
    `- Wide landscape format (3:2 ratio) — the output MUST be landscape, not square or portrait`,
    `- Zoom UI layout: toolbar at bottom, "Leave" button, participant tiles on right — keep untouched`,
    `- Warm orange/brown color scheme — keep untouched`,
    `- Desk setup with monitor, plants, decor — keep untouched`,
    ``,
    `MODIFICATIONS (change ONLY these, nothing else):`,
    ``,
    `1. LEFT WHITEBOARD PANEL:`,
    `   Restyle only the text; keep the panel itself untouched.`,
    `   Header: "Top Roles Hiring:" with these roles:`,
    data.rolesText,
    `   Write ONLY the roles listed above. Do NOT add filler text like "no additional roles found" or "more roles coming soon." If fewer than 3 roles are listed, leave the remaining panel space blank.`,
    `   Text must be fully legible, within panel bounds, not overflowing.`,
    ``,
    data.logoImage
      ? [
          `2. LOGO: Replace ONLY the top-center "HERE" circle with the company logo provided.`,
          `   Restyle only this one circle; keep everything else untouched.`,
          `   The logo must appear EXACTLY ONCE in the entire image.`,
        ].join('\n')
      : `2. LOGO: Keep the "HERE" circle as-is — do not change it.`,
    ``,
    `3. MONITOR: Replace desk monitor content with the dashboard screenshot provided.`,
    `   Restyle only the screen content; keep the monitor frame untouched.`,
    ``,
    data.prospectImage
      ? [
          `4. CENTER PERSON: Preserve the face from the prospect photo.`,
          `   Maintain their facial features (hair, skin tone, facial structure, glasses if any)`,
          `   but render in the same flat-color illustration style as the rest of the scene.`,
          `   Match skin tone on face, neck, hands.`,
          `   Adapt the person's body build, clothing, and footwear to match the prospect's apparent gender from their photo.`,
          `   If the prospect appears male, give the person a masculine build, male clothing, and flat shoes (no heels).`,
          `   If the prospect appears female, give the person a feminine build, female clothing, and appropriate footwear.`,
          `   Keep their seated-at-desk pose untouched.`,
        ].join('\n')
      : `4. CENTER PERSON: Keep as-is — do not change their appearance.`,
    ``,
    data.teamImages.length > 0
      ? [
          `5. VIDEO TILES: Preserve the faces from ${data.teamImages.length} team member photo(s).`,
          `   Maintain each person's facial features but render in the same illustration style.`,
          `   Unmodified tiles MUST stay exactly as-is — preserve their original diverse appearances.`,
        ].join('\n')
      : `5. VIDEO TILES: Keep all as-is — do not change any participant.`,
    corrections,
    ``,
    `FINAL CHECKS:`,
    `- Logo appears EXACTLY ONCE`,
    `- Unchanged people preserve their original diversity and appearance`,
    `- Consistent illustration style everywhere — clean lines, vibrant colors, no photorealistic elements`,
    `- All text legible and within bounds`,
    `- Wide landscape output (3:2 ratio), not square or portrait`,
    data.customPrompt ? `\nADDITIONAL USER INSTRUCTIONS (follow these carefully):\n${data.customPrompt}` : '',
  ].filter(Boolean).join('\n');
}

function buildZoomRoomAnalysisPrompt(data: PreparedData): string {
  const expectedRoles = data.rolesText.replace(/  \u2022 /g, '').split('\n').join(', ');

  const labels: string[] = [
    'Image 1 = original Zoom reference template (the LAYOUT to preserve)',
    'Image 2 = generated output (being reviewed)',
  ];
  let idx = 3;
  if (data.logoImage) { labels.push(`Image ${idx} = company logo (should replace top-center "HERE" circle)`); idx++; }
  if (data.prospectImage) { labels.push(`Image ${idx} = prospect face photo (center person should look like THIS)`); idx++; }
  for (let i = 0; i < data.teamImages.length; i++) { labels.push(`Image ${idx} = team member ${i + 1} face photo`); idx++; }

  return [
    `You are reviewing a generated Zoom Room postcard. We modified the reference template (Image 1). Verify the output (Image 2).`,
    ``,
    `IMAGES PROVIDED:`,
    ...labels.map((l) => `  ${l}`),
    ``,
    `WHAT WE ASKED: Preserve Image 1's layout, changing ONLY these:`,
    `- Whiteboard text -> "Top Roles Hiring:" + roles: ${expectedRoles}`,
    data.logoImage ? `- Top-center "HERE" circle -> company logo (provided as separate image)` : ``,
    `- Monitor content -> dashboard`,
    data.prospectImage ? `- Center person's face -> prospect photo features (intentional — should NOT match Image 1's center person)` : ``,
    data.teamImages.length > 0 ? `- ${data.teamImages.length} video tile face(s) -> team photo features. Other tiles UNCHANGED.` : ``,
    ``,
    `TARGET STYLE: Warm-toned flat-color corporate illustration with clean outlines — Pixar-inspired 2D style.`,
    ``,
    `EVALUATE Image 2:`,
    `1. ZOOM UI: Toolbar, "Leave" button, tiles on right preserved?`,
    `2. WHITEBOARD: "Top Roles Hiring:" with ${expectedRoles}? Legible, within bounds? Check SPELLING carefully — each role name must be spelled correctly. Compare letter by letter against: ${expectedRoles}. If any word is misspelled, FAIL this check. Also FAIL if any filler text appears (e.g. "no additional roles found", "more roles coming soon", "no other roles", or similar placeholder text). The whiteboard should show ONLY the listed roles and nothing else.`,
    data.logoImage ? `3. LOGO: Exactly ONE company logo matching the provided logo in top-center?` : `3. LOGO: N/A`,
    `4. MONITOR: Dashboard content on desk screen?`,
    data.prospectImage
      ? [
          `5. CENTER PERSON — CRITICAL CHECK:`,
          `   A prospect photo was provided. The center person's face MUST be REPLACED to match the prospect.`,
          `   Compare the center person in Image 2 against:`,
          `   - The PROSPECT PHOTO (the face they SHOULD have) — look at hair color, hair style, skin tone, gender, facial hair, glasses`,
          `   - Image 1's original center person (the face they should NO LONGER have)`,
          `   FAIL this check if the center person still looks like Image 1's original person.`,
          `   FAIL this check if hair color, skin tone, or gender don't match the prospect photo.`,
          `   BODY & CLOTHING CHECK: The person's body build, clothing, and footwear must match the prospect's apparent gender.`,
          `   FAIL if a male prospect has a feminine body, heels, a skirt, or other female clothing.`,
          `   FAIL if a female prospect has an overly masculine body or clothing that clearly doesn't match.`,
          `   This is the MOST IMPORTANT check — the whole point is to personalize the postcard for this prospect.`,
        ].join('\n')
      : `5. CENTER: N/A`,
    data.teamImages.length > 0 ? `6. VIDEO TILES: ${data.teamImages.length} tile(s) replaced with team photo features? Others unchanged and diverse? All faces in illustration style?` : `6. TILES: N/A`,
    `7. STYLE: Consistent flat-color illustration style? ALL faces (including replaced) must have clean outlines, flat colors — no photorealistic faces on illustrated bodies. STRICT.`,
    `8. FORMAT: Wide landscape image (3:2 ratio)? FAIL if square or portrait.`,
    ``,
    `For each check: PASS or FAIL with brief reason.`,
    `Then:`,
    `OVERALL: PASS or FAIL`,
    `ISSUES: Numbered actionable fixes (empty if PASS).`,
    ``,
    `CRITICAL RULE FOR ISSUES:`,
    `The generator cannot see numbered references. Use VISUAL DESCRIPTIONS:`,
    `BAD: "Replace center person with Image 4"`,
    `GOOD: "The center person should be a [gender, skin tone, hair color/style, glasses, distinguishing features]. Currently it looks like [problem]."`,
    `For style: "The center person's face is photorealistic with smooth gradients — redraw with flat colors and clean outlines."`,
    `For spelling: "The whiteboard says '[wrong]' but should say '[correct]'."`,
    ``,
    `The center person SHOULD differ from Image 1 — that's intentional.`,
  ].filter(Boolean).join('\n');
}

// ─── Agentic Generation Loops ───────────────────────────────────────────────

/**
 * Generates a War Room postcard using an agentic generate→analyze→correct loop.
 *
 * 1. Sends reference + all input images in a single pass
 * 2. Analyzes the output against reference and input images
 * 3. Regenerates with descriptive corrections if issues found
 * 4. Repeats up to MAX_ATTEMPTS times
 *
 * Returns base64-encoded PNG (no data: prefix).
 */
export async function generateNanaBananaWarRoom(input: NanoBananaInput): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');

  const data = await prepareWarRoomData(input);
  let currentImage: string | null = null;
  let previousIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Build image array: reference + logo + prospect + team + screen
    const images: ImageData[] = [data.reference];
    if (data.logoImage) images.push(data.logoImage);
    if (data.prospectImage) images.push(data.prospectImage);
    for (const tp of data.teamImages) images.push(tp);
    if (data.screen) images.push(data.screen);

    let prompt: string;
    if (currentImage && previousIssues.length > 0) {
      // Include the previous output so the model can see what went wrong
      images.push({ data: currentImage, mimeType: 'image/png' });
      prompt = buildWarRoomGenerationPrompt(data, previousIssues) +
        '\n\nThe LAST image provided is your previous attempt — study what went wrong and fix it.';
    } else {
      prompt = buildWarRoomGenerationPrompt(data);
    }

    console.log(`[NanoBanana] War Room attempt ${attempt}/${MAX_ATTEMPTS}...`);
    currentImage = await generateImage(prompt, images);

    // Skip analysis on last attempt — use whatever we got
    if (attempt === MAX_ATTEMPTS) {
      console.log('[NanoBanana] War Room max attempts reached, using last output');
      break;
    }

    // Analyze: pass all reference images so analyzer knows what to expect
    const analysisImages: ImageData[] = [
      data.reference,
      { data: currentImage, mimeType: 'image/png' },
    ];
    if (data.logoImage) analysisImages.push(data.logoImage);
    if (data.prospectImage) analysisImages.push(data.prospectImage);
    for (const tp of data.teamImages) analysisImages.push(tp);

    const analysisPrompt = buildWarRoomAnalysisPrompt(data);
    const analysis = await analyzeImage(analysisPrompt, analysisImages);
    const { pass, issues } = parseIssues(analysis);

    if (pass) {
      console.log(`[NanoBanana] War Room PASSED on attempt ${attempt}`);
      break;
    }

    console.log(`[NanoBanana] War Room FAIL attempt ${attempt}: ${issues.length} issue(s)`);
    previousIssues = issues;
  }

  if (!currentImage) throw new Error('War Room generation produced no image');
  return currentImage;
}

/**
 * Generates a Zoom Room postcard using an agentic generate→analyze→correct loop.
 *
 * Same pattern as War Room but with Zoom-specific prompts and layout.
 * Returns base64-encoded PNG (no data: prefix).
 */
export async function generateNanaBananaZoomRoom(input: NanoBananaInput): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');

  const data = await prepareZoomRoomData(input);
  let currentImage: string | null = null;
  let previousIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const images: ImageData[] = [data.reference];
    if (data.logoImage) images.push(data.logoImage);
    if (data.prospectImage) images.push(data.prospectImage);
    for (const tp of data.teamImages) images.push(tp);
    if (data.screen) images.push(data.screen);

    let prompt: string;
    if (currentImage && previousIssues.length > 0) {
      images.push({ data: currentImage, mimeType: 'image/png' });
      prompt = buildZoomRoomGenerationPrompt(data, previousIssues) +
        '\n\nThe LAST image provided is your previous attempt — study what went wrong and fix it.';
    } else {
      prompt = buildZoomRoomGenerationPrompt(data);
    }

    console.log(`[NanoBanana] Zoom Room attempt ${attempt}/${MAX_ATTEMPTS}...`);
    currentImage = await generateImage(prompt, images);

    // Skip analysis on last attempt
    if (attempt === MAX_ATTEMPTS) {
      console.log('[NanoBanana] Zoom Room max attempts reached, using last output');
      break;
    }

    // Analyze with all reference images
    const analysisImages: ImageData[] = [
      data.reference,
      { data: currentImage, mimeType: 'image/png' },
    ];
    if (data.logoImage) analysisImages.push(data.logoImage);
    if (data.prospectImage) analysisImages.push(data.prospectImage);
    for (const tp of data.teamImages) analysisImages.push(tp);

    const analysisPrompt = buildZoomRoomAnalysisPrompt(data);
    const analysis = await analyzeImage(analysisPrompt, analysisImages);
    const { pass, issues } = parseIssues(analysis);

    if (pass) {
      console.log(`[NanoBanana] Zoom Room PASSED on attempt ${attempt}`);
      break;
    }

    console.log(`[NanoBanana] Zoom Room FAIL attempt ${attempt}: ${issues.length} issue(s)`);
    previousIssues = issues;
  }

  if (!currentImage) throw new Error('Zoom Room generation produced no image');
  return currentImage;
}
