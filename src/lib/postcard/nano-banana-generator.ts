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
  /** Team member names/titles (parallel to teamPhotoUrls) — used to pick best standing presenter if prospect has no photo */
  teamMembers?: Array<{ name?: string; title?: string }>;
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
const MAX_ATTEMPTS = 7;
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

/** Generate an image from interleaved text+image parts */
async function generateImage(parts: object[]): Promise<string> {
  const imageModel = await getGeminiModel('image_gen');

  const result = await callGeminiWithRetry(imageModel, {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
    },
  });

  if (!result.image) throw new Error('No image in Gemini response');
  return result.image;
}

/** Build interleaved parts array: text label before each image so Gemini knows which is which */
function buildInterleavedParts(
  prompt: string,
  data: PreparedData,
  previousOutput?: string | null,
): object[] {
  const parts: object[] = [
    { text: prompt },
    { text: '\n\nHere is the base image to EDIT (the template with placeholder silhouettes):' },
    { inline_data: { mime_type: data.reference.mimeType, data: data.reference.data } },
  ];
  if (data.logoImage) {
    parts.push(
      { text: '\nHere is the COMPANY LOGO to place on the wall:' },
      { inline_data: { mime_type: data.logoImage.mimeType, data: data.logoImage.data } },
    );
  }
  if (data.prospectImage) {
    parts.push(
      { text: '\nHere is the PROSPECT\'s face photo — this person replaces Person 1 (the STANDING presenter). Match their face, hair, skin tone, and gender:' },
      { inline_data: { mime_type: data.prospectImage.mimeType, data: data.prospectImage.data } },
    );
  }
  for (let i = 0; i < data.teamImages.length; i++) {
    parts.push(
      { text: `\nHere is TEAM MEMBER ${i + 1}'s face photo — this person replaces Person ${i + 2} (SEATED at the table):` },
      { inline_data: { mime_type: data.teamImages[i].mimeType, data: data.teamImages[i].data } },
    );
  }
  if (data.screen) {
    parts.push(
      { text: '\nHere is the DASHBOARD screenshot to place on the monitor:' },
      { inline_data: { mime_type: data.screen.mimeType, data: data.screen.data } },
    );
  }
  if (previousOutput) {
    parts.push(
      { text: '\nHere is your PREVIOUS ATTEMPT — study what went wrong and fix it:' },
      { inline_data: { mime_type: 'image/png', data: previousOutput } },
    );
  }
  return parts;
}

/** Build interleaved parts for Zoom Room (Person 1 is seated at desk, not standing) */
function buildZoomInterleavedParts(
  prompt: string,
  data: PreparedData,
  previousOutput?: string | null,
): object[] {
  const parts: object[] = [
    { text: prompt },
    { text: '\n\nHere is the base image to EDIT (the Zoom call template with placeholder silhouettes):' },
    { inline_data: { mime_type: data.reference.mimeType, data: data.reference.data } },
  ];
  if (data.logoImage) {
    parts.push(
      { text: '\nHere is the COMPANY LOGO:' },
      { inline_data: { mime_type: data.logoImage.mimeType, data: data.logoImage.data } },
    );
  }
  if (data.prospectImage) {
    parts.push(
      { text: '\nHere is the PROSPECT\'s face photo — this person replaces Person 1 (center desk person). Match their face, hair, skin tone, and gender:' },
      { inline_data: { mime_type: data.prospectImage.mimeType, data: data.prospectImage.data } },
    );
  }
  for (let i = 0; i < data.teamImages.length; i++) {
    parts.push(
      { text: `\nHere is TEAM MEMBER ${i + 1}'s face photo — this person replaces Person ${i + 2} (video tile):` },
      { inline_data: { mime_type: data.teamImages[i].mimeType, data: data.teamImages[i].data } },
    );
  }
  if (data.screen) {
    parts.push(
      { text: '\nHere is the DASHBOARD screenshot for the monitor:' },
      { inline_data: { mime_type: data.screen.mimeType, data: data.screen.data } },
    );
  }
  if (previousOutput) {
    parts.push(
      { text: '\nHere is your PREVIOUS ATTEMPT — study what went wrong and fix it:' },
      { inline_data: { mime_type: 'image/png', data: previousOutput } },
    );
  }
  return parts;
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

// ─── Photo Validation ────────────────────────────────────────────────────────

/**
 * Validate photos in a single batch AI call to filter out LinkedIn gray
 * placeholders, silhouettes, generic icons, etc. Returns only real human photos.
 * If the AI call fails, returns all images unchanged (fail-open).
 */
async function validatePhotos(
  prospectImage: ImageData | null,
  teamImages: ImageData[],
): Promise<{ prospectImage: ImageData | null; teamImages: ImageData[] }> {
  const entries: { img: ImageData; label: string; isProspect: boolean; teamIdx: number }[] = [];
  if (prospectImage) {
    entries.push({ img: prospectImage, label: 'Prospect', isProspect: true, teamIdx: -1 });
  }
  teamImages.forEach((img, i) => {
    entries.push({ img, label: `Team ${i + 1}`, isProspect: false, teamIdx: i });
  });

  if (entries.length === 0) return { prospectImage, teamImages };

  const parts: object[] = [
    { text: [
      'Check each image below. Is it a real human photograph showing a recognizable person, or is it a placeholder/silhouette/generic avatar/gray icon/company logo/non-human image?',
      'Reply with EXACTLY one line per image in this format:',
      'Label: REAL or PLACEHOLDER',
      'Example:',
      'Prospect: REAL',
      'Team 1: PLACEHOLDER',
    ].join('\n') },
  ];

  for (const { img, label } of entries) {
    parts.push(
      { text: `\n${label}:` },
      { inline_data: { mime_type: img.mimeType, data: img.data } },
    );
  }

  try {
    const analysisModel = await getGeminiModel('image_analysis');
    const result = await callGeminiWithRetry(analysisModel, {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT'] },
    });

    const response = result.text ?? '';
    console.log(`[NanoBanana] Photo validation response: ${response.trim()}`);

    let filteredProspect = prospectImage;
    const keep = new Set(teamImages.map((_, i) => i));

    for (const entry of entries) {
      const regex = new RegExp(`${entry.label}.*PLACEHOLDER`, 'i');
      if (regex.test(response)) {
        if (entry.isProspect) {
          filteredProspect = null;
          console.log(`[NanoBanana] Prospect photo filtered as placeholder`);
          appLog('info', 'gemini', 'photo_validate', 'Prospect photo filtered as placeholder').catch(() => {});
        } else {
          keep.delete(entry.teamIdx);
          console.log(`[NanoBanana] Team member ${entry.teamIdx + 1} photo filtered as placeholder`);
          appLog('info', 'gemini', 'photo_validate', `Team member ${entry.teamIdx + 1} photo filtered as placeholder`).catch(() => {});
        }
      }
    }

    return {
      prospectImage: filteredProspect,
      teamImages: teamImages.filter((_, i) => keep.has(i)),
    };
  } catch (err) {
    // Fail-open: if validation fails, use all images as-is
    console.log(`[NanoBanana] Photo validation failed, proceeding with all images: ${(err as Error).message}`);
    appLog('warn', 'gemini', 'photo_validate', `Photo validation failed: ${(err as Error).message}`).catch(() => {});
    return { prospectImage, teamImages };
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
      if (res.statusCode !== 200) {
        appLog('warn', 'gemini', 'fetch_image_failed', `HTTP ${res.statusCode} fetching image`, { url: url.slice(0, 200) }).catch(() => {});
        resolve(null);
        return;
      }

      const contentType: string = res.headers['content-type'] ?? 'image/jpeg';
      const mimeType = contentType.split(';')[0].trim();

      // Gemini does not support SVG — skip placeholder avatars and SVG logos
      if (mimeType === 'image/svg+xml') {
        appLog('warn', 'gemini', 'fetch_image_svg', `Skipping SVG image (unsupported by Gemini)`, { url: url.slice(0, 200) }).catch(() => {});
        res.resume();
        resolve(null);
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // Skip suspiciously small images (< 2KB) — likely generic icons, not real photos
        if (buffer.length < 2048) {
          appLog('warn', 'gemini', 'fetch_image_tiny', `Skipping tiny image (${buffer.length} bytes)`, { url: url.slice(0, 200), size: buffer.length }).catch(() => {});
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
  if (!title) return '';
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

  // Hard cap at 50 chars — allow full titles on the whiteboard without truncation
  if (t.length > 50) {
    t = t.slice(0, 48) + '..';
  }

  return t;
}

// ─── Presenter Selection ────────────────────────────────────────────────────

/** Keywords that indicate someone responsible for hiring/recruiting */
const HIRING_KEYWORDS = [
  'recruit', 'talent', 'hiring', 'people', 'hr ', 'human resource',
  'staffing', 'acquisition', 'head of people', 'vp people', 'chief people',
];

/**
 * Pick the best team member to promote to standing presenter when the
 * prospect has no photo. Prefers recruiting/hiring-related titles.
 * Falls back to index 0 if no hiring-related title is found.
 */
function pickBestPresenterIndex(
  teamMembers: Array<{ name?: string; title?: string }> | undefined,
  teamCount: number,
): number {
  if (!teamMembers || teamMembers.length === 0) return 0;

  for (let i = 0; i < Math.min(teamMembers.length, teamCount); i++) {
    const title = teamMembers[i]?.title?.toLowerCase() ?? '';
    if (HIRING_KEYWORDS.some((kw) => title.includes(kw))) return i;
  }

  return 0; // default: first team member
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
  const screen = readLocalImageAsBase64(path.join(templatesDir, 'screen.png'));

  const [fetchedProspect, logoImage] = await Promise.all([
    input.prospectPhotoUrl ? fetchImageAsBase64(input.prospectPhotoUrl) : null,
    input.companyLogoUrl ? fetchImageAsBase64(input.companyLogoUrl) : null,
  ]);

  let teamImages: ImageData[] = [];
  if (input.teamPhotoUrls?.length) {
    const fetched = await Promise.all(input.teamPhotoUrls.slice(0, 5).map(url => fetchImageAsBase64(url)));
    for (const img of fetched) { if (img) teamImages.push(img); }
  }

  // Validate photos — filter out LinkedIn placeholders, gray icons, etc.
  // Must happen BEFORE template selection so headcount matches real photos only.
  const validated = await validatePhotos(fetchedProspect, teamImages);
  let prospectImage = validated.prospectImage;
  teamImages = validated.teamImages;

  // If prospect has no photo, promote the best team member to standing presenter
  // so the main slot isn't wasted on a generic illustrated person.
  // Prefer recruiting/hiring-related titles, otherwise pick the first available.
  if (!prospectImage && teamImages.length > 0) {
    const promoteIdx = pickBestPresenterIndex(input.teamMembers, teamImages.length);
    prospectImage = teamImages.splice(promoteIdx, 1)[0];
    const who = input.teamMembers?.[promoteIdx]?.name ?? `team member ${promoteIdx + 1}`;
    console.log(`[NanoBanana] No prospect photo — promoted ${who} to standing presenter`);
    appLog('info', 'system', 'postcard_promote', `No prospect photo, promoted ${who} to standing presenter`).catch(() => {});
  }

  // Pick the template variant that matches the exact headcount
  // (1 prospect + N team = totalPeople). Each variant has only the
  // silhouette placeholders needed, so Gemini won't hallucinate extras.
  const totalPeople = 1 + teamImages.length;
  const clamped = Math.min(Math.max(totalPeople, 1), 6);
  const templateFile = `reference-pose-${clamped}.png`;
  const reference = readLocalImageAsBase64(path.join(templatesDir, templateFile))
    ?? readLocalImageAsBase64(path.join(templatesDir, 'reference-pose.png'));
  if (!reference) throw new Error('reference-pose template not found in public/templates/');

  const rolesText = input.openRoles?.length
    ? input.openRoles.slice(0, 3).map(r => `  \u2022 ${normalizeJobTitle(r.title)}`).join('\n')
    : '  \u2022 SW Engineer\n  \u2022 Product Manager\n  \u2022 Data Analyst';

  return { reference, screen, prospectImage, logoImage, teamImages, rolesText, customPrompt: input.customPrompt };
}

async function prepareZoomRoomData(input: NanoBananaInput): Promise<PreparedData> {
  const templatesDir = path.join(process.cwd(), 'public', 'templates');
  const screen = readLocalImageAsBase64(path.join(templatesDir, 'screen.png'));

  const [fetchedProspect, logoImage] = await Promise.all([
    input.prospectPhotoUrl ? fetchImageAsBase64(input.prospectPhotoUrl) : null,
    input.companyLogoUrl ? fetchImageAsBase64(input.companyLogoUrl) : null,
  ]);

  let teamImages: ImageData[] = [];
  if (input.teamPhotoUrls?.length) {
    const fetched = await Promise.all(input.teamPhotoUrls.slice(0, 4).map(url => fetchImageAsBase64(url)));
    for (const img of fetched) { if (img) teamImages.push(img); }
  }

  // Validate photos — filter out LinkedIn placeholders, gray icons, etc.
  const validated = await validatePhotos(fetchedProspect, teamImages);
  let prospectImage = validated.prospectImage;
  teamImages = validated.teamImages;

  // If prospect has no photo, promote the best team member to center desk
  if (!prospectImage && teamImages.length > 0) {
    const promoteIdx = pickBestPresenterIndex(input.teamMembers, teamImages.length);
    prospectImage = teamImages.splice(promoteIdx, 1)[0];
    const who = input.teamMembers?.[promoteIdx]?.name ?? `team member ${promoteIdx + 1}`;
    console.log(`[NanoBanana] No prospect photo — promoted ${who} to center desk`);
    appLog('info', 'system', 'postcard_promote', `No prospect photo, promoted ${who} to center desk`).catch(() => {});
  }

  // Pick the template variant that matches the exact headcount
  const totalPeople = 1 + teamImages.length;
  const clamped = Math.min(Math.max(totalPeople, 1), 5);
  const templateFile = `zoom-room-reference-${clamped}.png`;
  const reference = readLocalImageAsBase64(path.join(templatesDir, templateFile))
    ?? readLocalImageAsBase64(path.join(templatesDir, 'zoom-room-reference.png'));
  if (!reference) throw new Error('zoom-room-reference template not found in public/templates/');

  const rolesText = input.openRoles?.length
    ? input.openRoles.slice(0, 3).map(r => `  \u2022 ${normalizeJobTitle(r.title)}`).join('\n')
    : '  \u2022 SW Engineer\n  \u2022 Product Manager\n  \u2022 Data Analyst';

  return { reference, screen, prospectImage, logoImage, teamImages, rolesText, customPrompt: input.customPrompt };
}

// ─── War Room Prompts ───────────────────────────────────────────────────────

function buildWarRoomGenerationPrompt(data: PreparedData, previousIssues?: string[]): string {
  const corrections = previousIssues?.length
    ? [
        '',
        'CRITICAL CORRECTIONS FROM PREVIOUS ATTEMPT (you MUST fix these):',
        ...previousIssues.map((issue, i) => `  ${i + 1}. ${issue}`),
        '',
      ].join('\n')
    : '';

  // Build people instructions — only for people we actually have photos for
  const totalPeople = 1 + data.teamImages.length; // 1 prospect + N team members
  const personSlots: string[] = [];

  if (data.prospectImage) {
    personSlots.push(
      `   - "Person 1" (standing presenter): This is the MAIN PROSPECT. Use the prospect face photo.`,
      `     This person MUST be STANDING — they are the presenter, not seated at the table.`,
      `     Preserve their facial features (hair, skin tone, facial structure, glasses, facial hair).`,
      `     Match gender — adapt body build, clothing, and footwear to the prospect's apparent gender.`,
      `     Give them a warm, friendly SMILE — happy and approachable expression.`,
      `     Render in illustration style, not photorealistic.`,
    );
  } else {
    personSlots.push(
      `   - "Person 1" (standing presenter): Draw a unique illustrated person STANDING (no photo provided).`,
      `     This person MUST be STANDING — they are the presenter, not seated.`,
    );
  }

  for (let i = 0; i < data.teamImages.length; i++) {
    personSlots.push(
      `   - "Person ${i + 2}" (seated): Use team member ${i + 1} face photo.`,
      `     Preserve their facial features, render in illustration style. Keep the seated pose.`,
      `     Give them a warm, friendly SMILE.`,
    );
  }

  return [
    `EDIT the base image (the War Room template). Do NOT generate a new scene from scratch — modify the template directly.`,
    `Replace the placeholder silhouettes and text with the provided content while keeping EVERYTHING ELSE exactly the same — same room layout, camera angle, furniture, lighting, colors, perspective, walls, windows, banner, plants.`,
    ``,
    `⚠️ CRITICAL: The reference template contains placeholder labels like "Person 1", "Role 1", "COMPANY LOGO". These are INSTRUCTIONS, not text to copy. You must REPLACE them with the actual content below. NEVER reproduce placeholder labels or square brackets in the output image.`,
    ``,
    `⚠️ HEADCOUNT: EXACTLY ${totalPeople} people — COUNT THEM: 1 standing + ${data.teamImages.length} seated = ${totalPeople} TOTAL. The template shows exactly ${totalPeople} silhouette placeholder(s). Replace each placeholder with an illustrated person — do NOT add any extra people beyond what the template shows. If you see more than ${totalPeople} people in your output, ERASE the extras completely.`,
    ``,
    `STYLE: Bold flat-color corporate illustration — clean outlines, vibrant colors, Pixar-inspired 2D. Every element including all people must match this style consistently. No photorealistic faces. ALL people must have warm, friendly SMILING expressions — happy and approachable, like a team photo.`,
    ``,
    `EDITS TO MAKE (replace the labeled placeholder slots):`,
    ``,
    `1. TOP ROLES whiteboard:`,
    `   Replace the placeholder text with:`,
    `   - Header: "TOP ROLES" in bold, CENTERED horizontally on the whiteboard`,
    `   - Roles listed below, CENTERED on the whiteboard:`,
    data.rolesText,
    `   - FONT STYLE (MANDATORY): Use a thick dry-erase marker handwriting style — like "Permanent Marker" or "Cabin Sketch" Google Font. Strokes should be bold, slightly uneven, and look like someone wrote them on a real whiteboard with a chunky marker. NOT thin pen, NOT cursive, NOT printed/typed. Think: casual whiteboard brainstorm writing.`,
    `   - Write ONLY these roles. No filler text. If fewer than 3, leave remaining space blank.`,
    `   - Each role title must be FULLY VISIBLE — no truncation, no ellipses, no cut-off text.`,
    `   - Text must be legible, CENTERED, and within the whiteboard bounds.`,
    ``,
    data.logoImage
      ? [
          `2. COMPANY LOGO circle on the wall:`,
          `   Replace with the provided company logo. Same position, same size.`,
          `   The logo must appear EXACTLY ONCE in the entire image.`,
        ].join('\n')
      : `2. COMPANY LOGO: No logo provided — draw a generic decorative circle.`,
    ``,
    `3. SCREENS: The wall-mounted monitor on the right side of the room shows a recruiting analytics dashboard. Replace its screen content with the provided dashboard screenshot image, fitting it within the monitor's bezel/frame. Keep the monitor shape, position, and size identical to the reference template.`,
    ``,
    `4. PEOPLE — render EXACTLY ${totalPeople} people, no more, no fewer:`,
    [
      `   People to render (match their appearance from provided photos):`,
      ...personSlots,
    ].join('\n'),
    `   - ALL people rendered in the same illustration style — vibrant, colorful, detailed characters.`,
    `   - The final image must have NO label text like "Person 1", "Person 2", etc.`,
    `   - NO gray silhouettes, shadows, outlines, or placeholder figures anywhere.`,
    `   - Person 1 MUST be STANDING. All other people MUST be SEATED.`,
    corrections,
    ``,
    `FINAL CHECKS — verify before outputting:`,
    `- ⚠️ COUNT every person: there must be EXACTLY ${totalPeople}. If more than ${totalPeople}, ERASE the extras completely.`,
    `- Person 1 is STANDING (not seated). All others are SEATED.`,
    `- Logo appears EXACTLY ONCE`,
    `- All text legible and within bounds`,
    `- No "Person N" label text from the template remains — all labels must be gone`,
    `- No square brackets in the image. Write clean text only.`,
    `- Consistent illustration style — no photorealistic elements`,
    `- Do NOT change the room layout, camera angle, or composition from the template`,
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
  if (data.logoImage) { labels.push(`Image ${idx} = company logo (should replace COMPANY LOGO slot, appear ONCE)`); idx++; }
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
    `- Fill TOP ROLES whiteboard with: ${expectedRoles}`,
    data.logoImage ? `- Fill COMPANY LOGO with the provided company logo (once only)` : `- No logo provided — should be a generic decorative circle`,
    `- Fill the wall-mounted monitor with the dashboard screenshot (fit within bezel)`,
    `- EXACTLY ${1 + data.teamImages.length} people total: 1 STANDING presenter + ${data.teamImages.length} SEATED at the table`,
    data.prospectImage ? `- Person 1 (STANDING) must match the prospect photo — this is the MAIN PROSPECT` : ``,
    data.teamImages.length > 0 ? `- Persons 2–${data.teamImages.length + 1} (SEATED) must match the ${data.teamImages.length} team member photo(s)` : ``,
    `- The template has exactly ${1 + data.teamImages.length} silhouette placeholders — there should be no extra people`,
    ``,
    `TARGET STYLE: Flat-color corporate illustration — clean outlines, vibrant colors, Pixar-inspired 2D. No photorealistic faces.`,
    ``,
    `EVALUATE Image 2:`,
    ``,
    `1. LAYOUT: Does Image 2 preserve the room layout from Image 1?`,
    `2. WHITEBOARD: Shows "TOP ROLES" with exactly: ${expectedRoles}? Check SPELLING letter by letter. FAIL if misspelled or if filler text appears (e.g. "more roles coming soon"). Only the listed roles should appear. Text must be CENTERED on the whiteboard and FULLY VISIBLE (no truncation, no ellipses, no cut-off).`,
    data.logoImage
      ? `3. LOGO: Company logo appears EXACTLY ONCE at the COMPANY LOGO position? Not duplicated elsewhere?`
      : `3. LOGO: N/A`,
    `4. SCREENS: Show dashboard content?`,
    data.prospectImage
      ? [
          `5. PERSON 1 (STANDING) — CRITICAL CHECK:`,
          `   Must match the prospect photo: hair color/style, skin tone, gender, glasses, facial hair.`,
          `   Body build and clothing must match prospect's apparent gender.`,
          `   MUST be STANDING, not seated. FAIL if Person 1 is seated or doesn't match the prospect photo.`,
          `   This is the MOST IMPORTANT check.`,
        ].join('\n')
      : `5. PERSON 1 (STANDING): Should be a fully illustrated person standing (not seated).`,
    data.teamImages.length > 0
      ? `6. PERSONS 2–${data.teamImages.length + 1} (SEATED): Do they match the ${data.teamImages.length} team member photo(s)? All in illustration style? All SEATED?`
      : `6. TEAM: N/A`,
    `7. HEADCOUNT CHECK — CRITICAL: Count every person in the image. There must be EXACTLY ${1 + data.teamImages.length} people. FAIL if there are more or fewer. The template had exactly ${1 + data.teamImages.length} silhouette placeholders — no extras should appear. Extra silhouettes, shadows, or invented people count as extra.`,
    `8. LABEL TEXT: Are ALL "Person N" labels from the template GONE? The final image must NOT contain any text like "Person 1", "Person 2", etc. Also FAIL if any placeholder labels or square-bracketed text appears — all labels must be replaced with clean text or graphics.`,
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
  const corrections = previousIssues?.length
    ? [
        '',
        'CRITICAL CORRECTIONS FROM PREVIOUS ATTEMPT (you MUST fix these):',
        ...previousIssues.map((issue, i) => `  ${i + 1}. ${issue}`),
        '',
      ].join('\n')
    : '';

  // Build people instructions — only for people we actually have photos for
  const totalPeople = 1 + data.teamImages.length; // 1 prospect + N team members
  const personSlots: string[] = [];

  if (data.prospectImage) {
    personSlots.push(
      `   - "Person 1" (center desk person — the MAIN PROSPECT): Use the prospect face photo.`,
      `     Preserve their facial features (hair, skin tone, facial structure, glasses, facial hair).`,
      `     Match gender — adapt body build, clothing to the prospect's apparent gender.`,
      `     Give them a warm, friendly SMILE — happy and approachable expression.`,
      `     Render in illustration style, not photorealistic. Keep the seated-at-desk pose.`,
    );
  } else {
    personSlots.push(
      `   - "Person 1" (center desk person): Draw a unique illustrated person seated at the desk (no photo provided).`,
    );
  }

  for (let i = 0; i < data.teamImages.length; i++) {
    personSlots.push(
      `   - "Person ${i + 2}" (video tile): Use team member ${i + 1} face photo.`,
      `     Preserve their facial features, render in illustration style.`,
      `     Give them a warm, friendly SMILE.`,
    );
  }

  return [
    `EDIT the base image (the Zoom call template). Do NOT generate a new scene from scratch — modify the template directly.`,
    `Replace the placeholder silhouettes and text with the provided content while keeping EVERYTHING ELSE exactly the same — same Zoom UI layout, desk, monitor, plants, toolbar, "Leave" button, video tiles.`,
    ``,
    `⚠️ CRITICAL: The reference template contains placeholder labels like "Person 1", "Role 1", "COMPANY LOGO". These are INSTRUCTIONS, not text to copy. You must REPLACE them with the actual content below. NEVER reproduce placeholder labels or square brackets in the output image.`,
    ``,
    `⚠️ HEADCOUNT: EXACTLY ${totalPeople} people — COUNT THEM: 1 at desk + ${data.teamImages.length} in video tiles = ${totalPeople} TOTAL. The template shows exactly ${totalPeople} silhouette placeholder(s). Replace each placeholder with an illustrated person — do NOT add any extra people beyond what the template shows. If you see more than ${totalPeople} people in your output, ERASE the extras completely.`,
    ``,
    `STYLE: Warm-toned flat-color corporate illustration — clean outlines, vibrant colors, Pixar-inspired 2D. Every element including all people must match this style consistently. No photorealistic faces. ALL people must have warm, friendly SMILING expressions — happy and approachable, like a team photo.`,
    ``,
    `EDITS TO MAKE (replace the labeled placeholder slots):`,
    ``,
    `1. TOP ROLES whiteboard panel:`,
    `   Replace the placeholder text with:`,
    `   - Header: "Top Roles Hiring:" in bold, CENTERED horizontally on the panel`,
    `   - Roles listed below, CENTERED on the panel:`,
    data.rolesText,
    `   - FONT STYLE (MANDATORY): Use a thick dry-erase marker handwriting style — like "Permanent Marker" or "Cabin Sketch" Google Font. Strokes should be bold, slightly uneven, and look like someone wrote them on a real whiteboard with a chunky marker. NOT thin pen, NOT cursive, NOT printed/typed. Think: casual whiteboard brainstorm writing.`,
    `   - Write ONLY these roles. No filler text. If fewer than 3, leave remaining space blank.`,
    `   - Each role title must be FULLY VISIBLE — no truncation, no ellipses, no cut-off text.`,
    `   - Text must be legible, CENTERED, and within the panel bounds.`,
    ``,
    data.logoImage
      ? [
          `2. COMPANY LOGO circle:`,
          `   Replace with the provided company logo. Same position, same size.`,
          `   The logo must appear EXACTLY ONCE in the entire image.`,
        ].join('\n')
      : `2. COMPANY LOGO: No logo provided — draw a generic decorative circle.`,
    ``,
    `3. MONITOR SCREEN: The desktop monitor on the desk in front of Person 1 shows a recruiting analytics dashboard. Replace its screen content with the provided dashboard screenshot image, fitting it within the monitor's bezel/frame. Keep the monitor shape, position, and size identical to the reference template.`,
    ``,
    `4. PEOPLE — render EXACTLY ${totalPeople} people, no more, no fewer:`,
    [
      `   People to render (match their appearance from provided photos):`,
      ...personSlots,
    ].join('\n'),
    `   - ALL people rendered in the same illustration style — vibrant, colorful, detailed characters.`,
    `   - The final image must have NO label text like "Person 1", "Person 2", etc.`,
    `   - NO gray silhouettes, shadows, outlines, or placeholder figures anywhere.`,
    corrections,
    ``,
    `FINAL CHECKS — verify before outputting:`,
    `- ⚠️ COUNT every person: there must be EXACTLY ${totalPeople}. If more than ${totalPeople}, ERASE the extras completely.`,
    `- Logo appears EXACTLY ONCE`,
    `- All text legible and within bounds`,
    `- No "Person N" label text from the template remains — all labels must be gone`,
    `- No square brackets in the image. Write clean text only.`,
    `- Consistent illustration style — no photorealistic elements`,
    `- Do NOT change the Zoom UI layout or composition from the template`,
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
  if (data.logoImage) { labels.push(`Image ${idx} = company logo (should replace COMPANY LOGO slot, appear ONCE)`); idx++; }
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
    `- Fill TOP ROLES whiteboard panel with: "Top Roles Hiring:" + ${expectedRoles}`,
    data.logoImage ? `- Fill COMPANY LOGO with the provided company logo (once only)` : `- No logo provided — should be a generic decorative circle`,
    `- Fill the desktop monitor with the dashboard screenshot (fit within bezel)`,
    `- EXACTLY ${1 + data.teamImages.length} people total: 1 center desk person + ${data.teamImages.length} in video tiles`,
    data.prospectImage ? `- Person 1 (center desk) must match the prospect photo — this is the MAIN PROSPECT` : ``,
    data.teamImages.length > 0 ? `- Persons 2–${data.teamImages.length + 1} (video tiles) must match the ${data.teamImages.length} team member photo(s)` : ``,
    `- The template has exactly ${1 + data.teamImages.length} silhouette placeholders — there should be no extra people`,
    ``,
    `TARGET STYLE: Warm-toned flat-color corporate illustration — clean outlines, vibrant colors, Pixar-inspired 2D. No photorealistic faces.`,
    ``,
    `EVALUATE Image 2:`,
    ``,
    `1. LAYOUT: Does Image 2 preserve the Zoom UI layout from Image 1? (toolbar, "Leave" button, tiles on right, desk setup)`,
    `2. WHITEBOARD: Shows "Top Roles Hiring:" with exactly: ${expectedRoles}? Check SPELLING letter by letter. FAIL if misspelled or if filler text appears (e.g. "more roles coming soon"). Only the listed roles should appear. Text must be CENTERED on the panel and FULLY VISIBLE (no truncation, no ellipses, no cut-off).`,
    data.logoImage
      ? `3. LOGO: Company logo appears EXACTLY ONCE at the COMPANY LOGO position? Not duplicated elsewhere?`
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
      : `5. PERSON 1 (CENTER DESK): Should be a fully illustrated person seated at the desk.`,
    data.teamImages.length > 0
      ? `6. PERSONS 2–${data.teamImages.length + 1} (VIDEO TILES): Do they match the ${data.teamImages.length} team member photo(s)? All in illustration style?`
      : `6. TEAM TILES: N/A`,
    `7. HEADCOUNT CHECK — CRITICAL: Count every person in the image. There must be EXACTLY ${1 + data.teamImages.length} people. FAIL if there are more or fewer. The template had exactly ${1 + data.teamImages.length} silhouette placeholders — no extras should appear. Extra silhouettes, shadows, or invented people count as extra.`,
    `8. LABEL TEXT: Are ALL "Person N" labels from the template GONE? The final image must NOT contain any text like "Person 1", "Person 2", etc. Also FAIL if any placeholder labels or square-bracketed text appears — all labels must be replaced with clean text or graphics.`,
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
export async function generateNanaBananaWarRoom(
  input: NanoBananaInput,
  onProgress?: (attempt: number, maxAttempts: number, status: string) => void,
): Promise<string> {
  if (GEMINI_KEYS.length === 0) throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');

  const data = await prepareWarRoomData(input);
  let currentImage: string | null = null;
  let previousIssues: string[] = [];
  // Track the best result across all attempts (fewest issues)
  let bestImage: string | null = null;
  let bestIssueCount = Infinity;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildWarRoomGenerationPrompt(data, previousIssues.length > 0 ? previousIssues : undefined);
    const parts = buildInterleavedParts(
      prompt,
      data,
      currentImage && previousIssues.length > 0 ? currentImage : null,
    );

    console.log(`[NanoBanana] War Room attempt ${attempt}/${MAX_ATTEMPTS}...`);
    onProgress?.(attempt, MAX_ATTEMPTS, 'generating');
    const genStart = Date.now();
    currentImage = await generateImage(parts);
    appLog('info', 'gemini', 'image_gen', `War Room image generated (attempt ${attempt}/${MAX_ATTEMPTS})`, { durationMs: Date.now() - genStart, attempt }).catch(() => {});

    // Analyze every attempt (including the last one)
    const analysisImages: ImageData[] = [
      data.reference,
      { data: currentImage, mimeType: 'image/png' },
    ];
    if (data.logoImage) analysisImages.push(data.logoImage);
    if (data.prospectImage) analysisImages.push(data.prospectImage);
    for (const tp of data.teamImages) analysisImages.push(tp);

    onProgress?.(attempt, MAX_ATTEMPTS, 'analyzing');
    const analysisPrompt = buildWarRoomAnalysisPrompt(data);
    const analysis = await analyzeImage(analysisPrompt, analysisImages);
    const { pass, issues } = parseIssues(analysis);

    // Track best result
    if (issues.length < bestIssueCount) {
      bestImage = currentImage;
      bestIssueCount = issues.length;
    }

    if (pass) {
      console.log(`[NanoBanana] War Room PASSED on attempt ${attempt}`);
      appLog('info', 'gemini', 'image_gen', `War Room PASSED on attempt ${attempt}`, { attempt }).catch(() => {});
      onProgress?.(attempt, MAX_ATTEMPTS, `passed`);
      return currentImage;
    }

    console.log(`[NanoBanana] War Room FAIL attempt ${attempt}: ${issues.length} issue(s)`);
    appLog('warn', 'gemini', 'image_gen', `War Room FAIL attempt ${attempt}: ${issues.length} issue(s)`, { attempt, issues }).catch(() => {});
    onProgress?.(attempt, MAX_ATTEMPTS, `failed: ${issues.join('; ').slice(0, 200)}`);
    previousIssues = issues;
  }

  // None passed — return the best attempt (fewest issues)
  console.log(`[NanoBanana] War Room: no attempt passed, using best (${bestIssueCount} issues)`);
  appLog('warn', 'gemini', 'image_gen', `War Room: no attempt passed after ${MAX_ATTEMPTS}, using best with ${bestIssueCount} issues`).catch(() => {});
  if (!bestImage) throw new Error('War Room generation produced no image');
  return bestImage;
}

/**
 * Generates a Zoom Room postcard using an agentic generate→analyze→correct loop.
 *
 * Same pattern as War Room but with Zoom-specific prompts and layout.
 * Returns base64-encoded PNG (no data: prefix).
 */
export async function generateNanaBananaZoomRoom(
  input: NanoBananaInput,
  onProgress?: (attempt: number, maxAttempts: number, status: string) => void,
): Promise<string> {
  if (GEMINI_KEYS.length === 0) throw new Error('No Gemini API key configured (set GEMINI_API_KEY or GOOGLE_AI_STUDIO)');

  const data = await prepareZoomRoomData(input);
  let currentImage: string | null = null;
  let previousIssues: string[] = [];
  let bestImage: string | null = null;
  let bestIssueCount = Infinity;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildZoomRoomGenerationPrompt(data, previousIssues.length > 0 ? previousIssues : undefined);
    const parts = buildZoomInterleavedParts(
      prompt,
      data,
      currentImage && previousIssues.length > 0 ? currentImage : null,
    );

    console.log(`[NanoBanana] Zoom Room attempt ${attempt}/${MAX_ATTEMPTS}...`);
    onProgress?.(attempt, MAX_ATTEMPTS, 'generating');
    const genStart = Date.now();
    currentImage = await generateImage(parts);
    appLog('info', 'gemini', 'image_gen', `Zoom Room image generated (attempt ${attempt}/${MAX_ATTEMPTS})`, { durationMs: Date.now() - genStart, attempt }).catch(() => {});

    // Analyze every attempt (including the last one)
    const analysisImages: ImageData[] = [
      data.reference,
      { data: currentImage, mimeType: 'image/png' },
    ];
    if (data.logoImage) analysisImages.push(data.logoImage);
    if (data.prospectImage) analysisImages.push(data.prospectImage);
    for (const tp of data.teamImages) analysisImages.push(tp);

    onProgress?.(attempt, MAX_ATTEMPTS, 'analyzing');
    const analysisPrompt = buildZoomRoomAnalysisPrompt(data);
    const analysis = await analyzeImage(analysisPrompt, analysisImages);
    const { pass, issues } = parseIssues(analysis);

    if (issues.length < bestIssueCount) {
      bestImage = currentImage;
      bestIssueCount = issues.length;
    }

    if (pass) {
      console.log(`[NanoBanana] Zoom Room PASSED on attempt ${attempt}`);
      appLog('info', 'gemini', 'image_gen', `Zoom Room PASSED on attempt ${attempt}`, { attempt }).catch(() => {});
      onProgress?.(attempt, MAX_ATTEMPTS, 'passed');
      return currentImage;
    }

    console.log(`[NanoBanana] Zoom Room FAIL attempt ${attempt}: ${issues.length} issue(s)`);
    appLog('warn', 'gemini', 'image_gen', `Zoom Room FAIL attempt ${attempt}: ${issues.length} issue(s)`, { attempt, issues }).catch(() => {});
    onProgress?.(attempt, MAX_ATTEMPTS, `failed: ${issues.join('; ').slice(0, 200)}`);
    previousIssues = issues;
  }

  console.log(`[NanoBanana] Zoom Room: no attempt passed, using best (${bestIssueCount} issues)`);
  appLog('warn', 'gemini', 'image_gen', `Zoom Room: no attempt passed after ${MAX_ATTEMPTS}, using best with ${bestIssueCount} issues`).catch(() => {});
  if (!bestImage) throw new Error('Zoom Room generation produced no image');
  return bestImage;
}
