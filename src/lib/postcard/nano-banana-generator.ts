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
import OpenAI from 'openai';
import { getGeminiModel, getModelConfigForRole } from '@/lib/ai/config';
import { appLog } from '@/lib/app-log';

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

// Collect all available Gemini API keys for rotation on 429
const GEMINI_KEYS: string[] = [
  process.env.GEMINI_API_KEY,
  process.env.GOOGLE_AI_STUDIO,
].filter(Boolean) as string[];
// Models loaded from DB at runtime via getGeminiModel() — configured in Admin → Models tab
const MAX_ATTEMPTS = 4;
const RATE_LIMIT_BACKOFF_MS = [2000, 5000, 10000]; // backoff delays for 429 retries

// ─── Gemini API ─────────────────────────────────────────────────────────────

class GeminiRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiRateLimitError';
  }
}

function callGemini(
  model: string,
  payload: object,
  apiKey: string,
): Promise<{ image?: string; text?: string }> {
  const body = JSON.stringify(payload);
  const urlPath = `/v1beta/models/${model}:generateContent?key=${apiKey}`;

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
            const code = parsed.error.code;
            if (code === 429) {
              reject(new GeminiRateLimitError(`Gemini 429: ${parsed.error.message ?? 'rate limited'}`));
              return;
            }
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

/** Call Gemini with key rotation and backoff on 429 */
async function callGeminiWithRetry(
  model: string,
  payload: object,
): Promise<{ image?: string; text?: string }> {
  if (GEMINI_KEYS.length === 0) {
    throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');
  }

  let lastError: Error | null = null;
  // Try each key, with backoff between attempts
  for (let attempt = 0; attempt < GEMINI_KEYS.length + RATE_LIMIT_BACKOFF_MS.length; attempt++) {
    const keyIdx = attempt % GEMINI_KEYS.length;
    const key = GEMINI_KEYS[keyIdx];
    try {
      return await callGemini(model, payload, key);
    } catch (err) {
      if (err instanceof GeminiRateLimitError) {
        lastError = err;
        const backoffIdx = Math.min(Math.floor(attempt / GEMINI_KEYS.length), RATE_LIMIT_BACKOFF_MS.length - 1);
        const delay = RATE_LIMIT_BACKOFF_MS[backoffIdx];
        console.log(`[NanoBanana] 429 on key ${keyIdx + 1}/${GEMINI_KEYS.length}, backing off ${delay}ms...`);
        appLog('warn', 'gemini', 'rate_limit', `429 on key ${keyIdx + 1}/${GEMINI_KEYS.length}, backing off ${delay}ms`, { model, attempt, delay }).catch(() => {});
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err; // non-429 errors propagate immediately
    }
  }
  appLog('error', 'gemini', 'rate_limit', 'All Gemini API keys exhausted after retries', { model }).catch(() => {});
  throw lastError ?? new Error('All Gemini API keys rate limited');
}

/** Generate an image from a prompt + input images */
async function generateImage(prompt: string, images: ImageData[]): Promise<string> {
  const imageModel = await getGeminiModel('image_gen');
  const parts: object[] = [
    { text: prompt },
    ...images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } })),
  ];

  const result = await callGeminiWithRetry(imageModel, {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });

  if (!result.image) throw new Error('No image in Gemini response');
  return result.image;
}

/** Analyze an image via OpenAI vision (fallback when Gemini is rate-limited) */
async function analyzeImageWithOpenAI(prompt: string, images: ImageData[]): Promise<string> {
  const fallbackConfig = await getModelConfigForRole('fallback');
  const modelId = fallbackConfig.modelId;
  console.log(`[NanoBanana] Falling back to OpenAI vision: ${modelId}`);

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [
    { type: 'text', text: prompt },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    })),
  ];

  const isNewModel = modelId.startsWith('gpt-5') || modelId.startsWith('o3') || modelId.startsWith('o4');
  const tokenParam = isNewModel
    ? { max_completion_tokens: 4096 }
    : { max_tokens: 4096 };

  const response = await openai.chat.completions.create({
    model: modelId,
    messages: [{ role: 'user', content }],
    ...tokenParam,
  } as Parameters<typeof openai.chat.completions.create>[0]) as OpenAI.ChatCompletion;

  return response.choices[0]?.message?.content ?? '(no analysis returned)';
}

/** Analyze an image with text — returns text analysis. Falls back to OpenAI on Gemini 429. */
async function analyzeImage(prompt: string, images: ImageData[]): Promise<string> {
  const analysisModel = await getGeminiModel('image_analysis');
  const parts: object[] = [
    { text: prompt },
    ...images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } })),
  ];

  try {
    const result = await callGeminiWithRetry(analysisModel, {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT'] },
    });
    return result.text ?? '(no analysis returned)';
  } catch (err) {
    if (err instanceof GeminiRateLimitError) {
      console.log(`[NanoBanana] Gemini analysis rate-limited, falling back to OpenAI`);
      appLog('warn', 'gemini', 'fallback', 'Gemini analysis rate-limited, falling back to OpenAI vision').catch(() => {});
      return analyzeImageWithOpenAI(prompt, images);
    }
    throw err;
  }
}

// ─── Image Fetching ─────────────────────────────────────────────────────────

/** Known generic/placeholder avatar URL patterns — these are NOT real photos */
const GENERIC_AVATAR_PATTERNS = [
  'static.licdn.com/aero-v1/sc/h/',    // LinkedIn default gray silhouette (SVG)
  'static.licdn.com/sc/h/',             // Older LinkedIn default avatar path
  '/default-avatar',                     // Common placeholder pattern
  'gravatar.com/avatar/',                // Gravatar default (may be a generated icon)
];

/** Returns true if the URL points to a known generic/placeholder avatar */
function isGenericAvatar(url: string): boolean {
  return GENERIC_AVATAR_PATTERNS.some((pattern) => url.includes(pattern));
}

/** Fetch a remote image URL and return base64 + mimeType */
async function fetchImageAsBase64(url: string): Promise<ImageData | null> {
  // Skip known generic/placeholder avatars before making any network request
  if (isGenericAvatar(url)) {
    console.log(`[NanoBanana] Skipping generic avatar: ${url.slice(0, 80)}...`);
    return null;
  }

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
        // Skip suspiciously small images (< 2KB) — likely generic icons, not real photos
        if (buffer.length < 2048) {
          console.log(`[NanoBanana] Skipping tiny image (${buffer.length} bytes): ${url.slice(0, 80)}...`);
          resolve(null);
          return;
        }
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
      const cleaned = line.replace(/^\s*\d+[\.\)]\s*/, '').replace(/^\*+\s*/, '').replace(/^[-•]\s*/, '').trim();
      if (cleaned && cleaned !== 'None' && cleaned !== 'N/A' && cleaned !== '(none)' && cleaned !== '(None)' && cleaned.length > 5) {
        issues.push(cleaned);
      }
    }
  }

  // If analysis says FAIL but we couldn't parse specific issues, extract FAIL
  // lines from the per-check section as fallback — the generator needs feedback
  if (!pass && issues.length === 0) {
    const failLines = analysis
      .split('\n')
      .filter((l) => /FAIL/i.test(l) && !/OVERALL/i.test(l))
      .map((l) => l.replace(/^\s*\d+[\.\)]\s*/, '').trim())
      .filter((l) => l.length > 10);
    if (failLines.length > 0) {
      issues.push(...failLines);
    } else {
      // Last resort: include a trimmed version of the full analysis
      const trimmed = analysis.slice(0, 500).trim();
      issues.push(`Analysis returned FAIL. Full feedback: ${trimmed}`);
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

  // Hard cap at 35 chars — enough for most abbreviated titles
  if (t.length > 35) {
    t = t.slice(0, 33) + '..';
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

  // Build people instructions — slots with photos use the photo, slots without get generic illustrated people
  const personSlots: string[] = [];
  const genericSlots: string[] = [];

  if (data.prospectImage) {
    personSlots.push(
      `   - "Person 1" (standing presenter): Use the prospect face photo.`,
      `     Preserve their facial features (hair, skin tone, facial structure, glasses, facial hair).`,
      `     Match gender — adapt body build, clothing, and footwear to the prospect's apparent gender.`,
      `     Give them a warm, friendly SMILE — happy and approachable expression.`,
      `     Render in illustration style, not photorealistic. Keep the standing pose.`,
    );
  } else {
    genericSlots.push(`"Person 1" (standing presenter)`);
  }

  for (let i = 0; i < 5; i++) {
    if (i < data.teamImages.length) {
      personSlots.push(
        `   - "Person ${i + 2}" (seated): Use team member ${i + 1} face photo.`,
        `     Preserve their facial features, render in illustration style. Keep the seated pose.`,
        `     Give them a warm, friendly SMILE.`,
      );
    } else {
      genericSlots.push(`"Person ${i + 2}" (seated)`);
    }
  }

  return [
    `The reference template (Image 1) shows a War Room scene with labeled placeholder slots.`,
    `Reproduce this scene EXACTLY, filling in the labeled slots with the provided images. Output a single wide landscape image.`,
    ``,
    `IMAGE LABELS:`,
    ...imageLabels.map((l) => `  ${l}`),
    ``,
    `STYLE: Bold flat-color corporate illustration — clean outlines, vibrant colors, Pixar-inspired 2D. Every element including all people must match this style consistently. No photorealistic faces. ALL people must have warm, friendly SMILING expressions — happy and approachable, like a team photo.`,
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
    `4. PEOPLE — EVERY labeled person slot in the reference MUST become a fully illustrated human. No gray silhouettes, no shadows, no placeholders, no outlines — only real colorful illustrated people.`,
    personSlots.length > 0
      ? [
          `   People with provided photos (match their appearance):`,
          ...personSlots,
        ].join('\n')
      : '',
    genericSlots.length > 0
      ? [
          `   People WITHOUT photos — draw a unique, friendly, diverse illustrated person for each:`,
          ...genericSlots.map(s => `   - ${s}: Draw a unique illustrated person. Pick a random gender, ethnicity, hair style, and professional clothing. Must look like a real illustrated character — warm smile, vibrant colors, full detail. NOT a silhouette, NOT a shadow, NOT a gray figure.`),
        ].join('\n')
      : '',
    `   - ALL people rendered in the same illustration style — vibrant, colorful, detailed characters.`,
    `   - The final image must have NO label text like "Person 1", "Person 2", etc. — all labels replaced by actual illustrated people.`,
    `   - NO gray silhouettes, shadows, outlines, or placeholder figures anywhere. Every person slot must be a fully colored, detailed illustrated human.`,
    corrections,
    ``,
    `FINAL CHECKS:`,
    `- Logo appears EXACTLY ONCE`,
    `- All text legible and within bounds`,
    `- Wide landscape output (3:2), not square or portrait`,
    `- Every person slot is a FULLY ILLUSTRATED colorful human — no gray silhouettes, no shadows, no placeholder outlines, no ghost figures`,
    `- No "Person N" label text from the template remains — all labels must be gone`,
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
    `- All person slots (even without provided photos) must be FULLY ILLUSTRATED colorful people — no gray silhouettes, no shadow figures, no placeholder outlines`,
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
      : `5. PERSON 1 (STANDING): Should be a fully illustrated person (no photo provided — generic is fine, but must be colorful and detailed, NOT a silhouette).`,
    data.teamImages.length > 0
      ? `6. PERSONS 2–${data.teamImages.length + 1} (SEATED): Do they match the ${data.teamImages.length} team member photo(s)? All in illustration style?`
      : `6. TEAM: N/A`,
    `7. PLACEHOLDER/SILHOUETTE CHECK — CRITICAL: Look at EVERY person in the image. FAIL if ANY person appears as a gray silhouette, shadow figure, dark outline, translucent shape, or placeholder. Every person must be a fully colored, detailed illustrated human with visible facial features, clothing, and skin tones. Gray/dark/featureless figures are NOT acceptable.`,
    `8. LABEL TEXT: Are ALL "Person N" labels from the template GONE? The final image must NOT contain any text like "Person 1", "Person 2", etc. FAIL if any person-slot labels are visible.`,
    `9. STYLE: Consistent illustration style on ALL faces — flat colors, clean outlines, no photorealistic faces?`,
    `10. FORMAT: Wide landscape (3:2)?`,
    ``,
    `For each: PASS or FAIL with brief reason.`,
    `OVERALL: PASS or FAIL`,
    `ISSUES: Numbered actionable fixes (empty if PASS).`,
    ``,
    `RULE FOR ISSUES: The generator cannot see image numbers. Use VISUAL DESCRIPTIONS only:`,
    `BAD: "Make Person 1 look like Image 4"`,
    `GOOD: "Person 1 (standing) should be a [gender] with [skin tone], [hair], [glasses]. Currently looks like [problem]."`,
    `For spelling: "Whiteboard says '[wrong]' but should say '[correct]'."`,
    `For labels: "The text 'Person 3' is still visible on the right side — remove it completely."`,
    `For silhouettes: "The person on the [position] chair is a gray silhouette/shadow — replace it with a fully illustrated colorful person with visible features, clothing, and skin tone."`,
  ].filter(Boolean).join('\n');
}

// ─── Zoom Room Prompts ──────────────────────────────────────────────────────

function buildZoomRoomGenerationPrompt(data: PreparedData, previousIssues?: string[]): string {
  // Build image label list — maps each provided image to its labeled slot in the reference
  const imageLabels: string[] = ['Image 1 = reference template (follow this layout EXACTLY — it has labeled placeholder slots)'];
  let imgIdx = 2;
  if (data.logoImage) { imageLabels.push(`Image ${imgIdx} = company logo → replaces [COMPANY LOGO] slot`); imgIdx++; }
  if (data.prospectImage) { imageLabels.push(`Image ${imgIdx} = prospect face photo → replaces "Person 1" (center desk person)`); imgIdx++; }
  for (let i = 0; i < data.teamImages.length; i++) {
    imageLabels.push(`Image ${imgIdx} = team member ${i + 1} face photo → replaces "Person ${i + 2}" (video tile)`);
    imgIdx++;
  }
  if (data.screen) imageLabels.push(`Image ${imgIdx} = dashboard screenshot → replaces monitor screen content`);

  const corrections = previousIssues?.length
    ? [
        '',
        'CRITICAL CORRECTIONS FROM PREVIOUS ATTEMPT (you MUST fix these):',
        ...previousIssues.map((issue, i) => `  ${i + 1}. ${issue}`),
        '',
      ].join('\n')
    : '';

  // Build people instructions — slots with photos use the photo, slots without get generic illustrated people
  const personSlots: string[] = [];
  const genericSlots: string[] = [];

  if (data.prospectImage) {
    personSlots.push(
      `   - "Person 1" (center desk person): Use the prospect face photo.`,
      `     Preserve their facial features (hair, skin tone, facial structure, glasses, facial hair).`,
      `     Match gender — adapt body build, clothing to the prospect's apparent gender.`,
      `     Give them a warm, friendly SMILE — happy and approachable expression.`,
      `     Render in illustration style, not photorealistic. Keep the seated-at-desk pose.`,
    );
  } else {
    genericSlots.push(`"Person 1" (center desk person)`);
  }

  for (let i = 0; i < 4; i++) {
    if (i < data.teamImages.length) {
      personSlots.push(
        `   - "Person ${i + 2}" (video tile): Use team member ${i + 1} face photo.`,
        `     Preserve their facial features, render in illustration style.`,
        `     Give them a warm, friendly SMILE.`,
      );
    } else {
      genericSlots.push(`"Person ${i + 2}" (video tile)`);
    }
  }

  return [
    `The reference template (Image 1) shows a Zoom call scene with labeled placeholder slots.`,
    `Reproduce this scene EXACTLY, filling in the labeled slots with the provided images. Output a single wide landscape image.`,
    ``,
    `IMAGE LABELS:`,
    ...imageLabels.map((l) => `  ${l}`),
    ``,
    `STYLE: Warm-toned flat-color corporate illustration — clean outlines, vibrant colors, Pixar-inspired 2D. Every element including all people must match this style consistently. No photorealistic faces. ALL people must have warm, friendly SMILING expressions — happy and approachable, like a team photo.`,
    ``,
    `The reference template already defines the Zoom UI layout, desk, monitor, plants, toolbar, "Leave" button, etc. Keep ALL of that exactly as shown. Only fill in the labeled placeholder slots:`,
    ``,
    `1. [TOP ROLES] whiteboard panel:`,
    `   Replace the placeholder text with:`,
    `   - Header: "Top Roles Hiring:" in bold`,
    `   - Roles listed below in clean handwritten style:`,
    data.rolesText,
    `   - Write ONLY these roles. No filler text. If fewer than 3, leave remaining space blank.`,
    `   - Text must be legible and within the panel bounds.`,
    ``,
    data.logoImage
      ? [
          `2. [COMPANY LOGO] circle:`,
          `   Replace with the provided company logo. Same position, same size.`,
          `   The logo must appear EXACTLY ONCE in the entire image.`,
        ].join('\n')
      : `2. [COMPANY LOGO]: No logo provided — draw a generic decorative circle.`,
    ``,
    `3. MONITOR SCREEN: Replace monitor content with the provided dashboard screenshot.`,
    ``,
    `4. PEOPLE — EVERY labeled person slot in the reference MUST become a fully illustrated human. No gray silhouettes, no shadows, no placeholders, no outlines — only real colorful illustrated people.`,
    personSlots.length > 0
      ? [
          `   People with provided photos (match their appearance):`,
          ...personSlots,
        ].join('\n')
      : '',
    genericSlots.length > 0
      ? [
          `   People WITHOUT photos — draw a unique, friendly, diverse illustrated person for each:`,
          ...genericSlots.map(s => `   - ${s}: Draw a unique illustrated person. Pick a random gender, ethnicity, hair style, and professional clothing. Must look like a real illustrated character — warm smile, vibrant colors, full detail. NOT a silhouette, NOT a shadow, NOT a gray figure.`),
        ].join('\n')
      : '',
    `   - ALL people rendered in the same illustration style — vibrant, colorful, detailed characters.`,
    `   - The final image must have NO label text like "Person 1", "Person 2", etc. — all labels replaced by actual illustrated people.`,
    `   - NO gray silhouettes, shadows, outlines, or placeholder figures anywhere. Every person slot must be a fully colored, detailed illustrated human.`,
    corrections,
    ``,
    `FINAL CHECKS:`,
    `- Logo appears EXACTLY ONCE`,
    `- All text legible and within bounds`,
    `- Wide landscape output (3:2), not square or portrait`,
    `- Every person slot is a FULLY ILLUSTRATED colorful human — no gray silhouettes, no shadows, no placeholder outlines, no ghost figures`,
    `- No "Person N" label text from the template remains — all labels must be gone`,
    `- Consistent illustration style — no photorealistic elements`,
    data.customPrompt ? `\nADDITIONAL USER INSTRUCTIONS (follow these carefully):\n${data.customPrompt}` : '',
  ].filter(Boolean).join('\n');
}

function buildZoomRoomAnalysisPrompt(data: PreparedData): string {
  const expectedRoles = data.rolesText.replace(/  \u2022 /g, '').split('\n').join(', ');

  const labels: string[] = [
    'Image 1 = reference template (has labeled placeholder slots — the LAYOUT to preserve)',
    'Image 2 = generated output (the image being reviewed)',
  ];
  let idx = 3;
  if (data.logoImage) { labels.push(`Image ${idx} = company logo (should replace [COMPANY LOGO] slot, appear ONCE)`); idx++; }
  if (data.prospectImage) { labels.push(`Image ${idx} = prospect face photo (should replace "Person 1" — the center desk person)`); idx++; }
  for (let i = 0; i < data.teamImages.length; i++) {
    labels.push(`Image ${idx} = team member ${i + 1} face photo (should replace "Person ${i + 2}")`);
    idx++;
  }

  return [
    `You are reviewing a generated Zoom Room postcard. The reference template (Image 1) has labeled placeholder slots. We asked the AI to fill them in. Verify it was done correctly.`,
    ``,
    `IMAGES PROVIDED:`,
    ...labels.map((l) => `  ${l}`),
    ``,
    `WHAT WE ASKED:`,
    `- Fill [TOP ROLES] whiteboard panel with: "Top Roles Hiring:" + ${expectedRoles}`,
    data.logoImage ? `- Fill [COMPANY LOGO] with the provided company logo (once only)` : `- No logo provided — should be a generic decorative circle`,
    `- Fill monitor screen with the dashboard screenshot`,
    data.prospectImage ? `- Replace "Person 1" (center desk) with the prospect's facial features — intentional, should NOT match the gray silhouette` : ``,
    data.teamImages.length > 0 ? `- Replace "Person 2"–"Person ${data.teamImages.length + 1}" with team member faces` : ``,
    `- All person slots (even without provided photos) must be FULLY ILLUSTRATED colorful people — no gray silhouettes, no shadow figures, no placeholder outlines`,
    ``,
    `TARGET STYLE: Warm-toned flat-color corporate illustration — clean outlines, vibrant colors, Pixar-inspired 2D. No photorealistic faces.`,
    ``,
    `EVALUATE Image 2:`,
    ``,
    `1. LAYOUT: Does Image 2 preserve the Zoom UI layout from Image 1? (toolbar, "Leave" button, tiles on right, desk setup)`,
    `2. WHITEBOARD: Shows "Top Roles Hiring:" with exactly: ${expectedRoles}? Check SPELLING letter by letter. FAIL if misspelled or if filler text appears (e.g. "more roles coming soon"). Only the listed roles should appear.`,
    data.logoImage
      ? `3. LOGO: Company logo appears EXACTLY ONCE at the [COMPANY LOGO] position? Not duplicated elsewhere?`
      : `3. LOGO: N/A`,
    `4. MONITOR: Shows dashboard content on desk screen?`,
    data.prospectImage
      ? [
          `5. PERSON 1 (CENTER DESK) — CRITICAL CHECK:`,
          `   Must match the prospect photo: hair color/style, skin tone, gender, glasses, facial hair.`,
          `   Body build and clothing must match prospect's apparent gender.`,
          `   FAIL if Person 1 still looks like a gray silhouette or doesn't match the prospect photo.`,
          `   This is the MOST IMPORTANT check.`,
        ].join('\n')
      : `5. PERSON 1 (CENTER DESK): Should be a fully illustrated person (no photo provided — generic is fine, but must be colorful and detailed, NOT a silhouette).`,
    data.teamImages.length > 0
      ? `6. PERSONS 2–${data.teamImages.length + 1} (VIDEO TILES): Do they match the ${data.teamImages.length} team member photo(s)? All in illustration style?`
      : `6. TEAM TILES: N/A`,
    `7. PLACEHOLDER/SILHOUETTE CHECK — CRITICAL: Look at EVERY person in the image. FAIL if ANY person appears as a gray silhouette, shadow figure, dark outline, translucent shape, or placeholder. Every person must be a fully colored, detailed illustrated human with visible facial features, clothing, and skin tones. Gray/dark/featureless figures are NOT acceptable.`,
    `8. LABEL TEXT: Are ALL "Person N" labels from the template GONE? The final image must NOT contain any text like "Person 1", "Person 2", etc. FAIL if any person-slot labels are visible.`,
    `9. STYLE: Consistent illustration style on ALL faces — flat colors, clean outlines, no photorealistic faces?`,
    `10. FORMAT: Wide landscape (3:2)?`,
    ``,
    `For each: PASS or FAIL with brief reason.`,
    `OVERALL: PASS or FAIL`,
    `ISSUES: Numbered actionable fixes (empty if PASS).`,
    ``,
    `RULE FOR ISSUES: The generator cannot see image numbers. Use VISUAL DESCRIPTIONS only:`,
    `BAD: "Make Person 1 look like Image 4"`,
    `GOOD: "Person 1 (center desk) should be a [gender] with [skin tone], [hair], [glasses]. Currently looks like [problem]."`,
    `For spelling: "Whiteboard says '[wrong]' but should say '[correct]'."`,
    `For labels: "The text 'Person 3' is still visible on a video tile — remove it completely."`,
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
  if (GEMINI_KEYS.length === 0) throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');

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
    const genStart = Date.now();
    currentImage = await generateImage(prompt, images);
    appLog('info', 'gemini', 'image_gen', `War Room image generated (attempt ${attempt}/${MAX_ATTEMPTS})`, { durationMs: Date.now() - genStart, attempt }).catch(() => {});

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
      appLog('info', 'gemini', 'image_gen', `War Room PASSED on attempt ${attempt}`, { attempt }).catch(() => {});
      break;
    }

    console.log(`[NanoBanana] War Room FAIL attempt ${attempt}: ${issues.length} issue(s)`);
    appLog('warn', 'gemini', 'image_gen', `War Room FAIL attempt ${attempt}: ${issues.length} issue(s)`, { attempt, issues }).catch(() => {});
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
  if (GEMINI_KEYS.length === 0) throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');

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
    const genStart = Date.now();
    currentImage = await generateImage(prompt, images);
    appLog('info', 'gemini', 'image_gen', `Zoom Room image generated (attempt ${attempt}/${MAX_ATTEMPTS})`, { durationMs: Date.now() - genStart, attempt }).catch(() => {});

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
      appLog('info', 'gemini', 'image_gen', `Zoom Room PASSED on attempt ${attempt}`, { attempt }).catch(() => {});
      break;
    }

    console.log(`[NanoBanana] Zoom Room FAIL attempt ${attempt}: ${issues.length} issue(s)`);
    appLog('warn', 'gemini', 'image_gen', `Zoom Room FAIL attempt ${attempt}: ${issues.length} issue(s)`, { attempt, issues }).catch(() => {});
    previousIssues = issues;
  }

  if (!currentImage) throw new Error('Zoom Room generation produced no image');
  return currentImage;
}
