import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import { getGeminiModel } from "@/lib/ai/config";
import axios from "axios";

export const maxDuration = 300;

const VETRIC_BASE = "https://api.vetric.io/linkedin/v1";

function extractSlug(url: string | null): string | null {
  if (!url) return null;
  if (url.includes("linkedin.com/in/"))
    return url
      .replace(/^.*linkedin\.com\/in\//, "")
      .replace(/[/?#].*$/, "")
      .trim();
  return url.trim();
}

async function downloadAsBase64(
  url: string
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const r = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const ct = (r.headers["content-type"] as string) || "image/jpeg";
    const mimeType = ct.split(";")[0].trim();
    return {
      base64: Buffer.from(r.data).toString("base64"),
      mimeType: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
    };
  } catch {
    return null;
  }
}

interface CompareResult {
  contactId: string;
  name: string;
  company: string;
  slug: string;
  dbPhotoUrl: string | null;
  vetricPhotoUrl: string | null;
  verdict: "MATCH" | "MISMATCH" | "MISSING" | "ERROR";
  reason: string;
}

// POST /api/photo-fixer/compare
// Body: { batchId: string }
// Returns: { results: CompareResult[] }
export async function POST(request: Request) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { batchId } = await request.json();
  if (!batchId)
    return NextResponse.json(
      { error: "batchId required" },
      { status: 400 }
    );

  const teamUserIds = await getTeamUserIds(user);

  // Get all contacts from this batch
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, userId: { in: teamUserIds } },
    include: {
      jobs: {
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              company: true,
              linkedinUrl: true,
              profileImageUrl: true,
            },
          },
        },
      },
    },
  });

  if (!batch)
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const contacts = batch.jobs
    .map((j) => j.contact)
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Fetch Vetric photos for all contacts
  const vetricHeaders = {
    "x-api-key": process.env.LI_API_KEY || "",
    accept: "application/json",
  };

  interface ContactWithPhotos {
    contactId: string;
    name: string;
    company: string;
    slug: string;
    dbPhotoUrl: string | null;
    vetricPhotoUrl: string | null;
    dbImg: { base64: string; mimeType: string } | null;
    vetricImg: { base64: string; mimeType: string } | null;
  }

  const pairs: ContactWithPhotos[] = [];

  // Fetch Vetric data + download images in parallel batches of 10
  const FETCH_BATCH = 10;
  for (let i = 0; i < contacts.length; i += FETCH_BATCH) {
    const chunk = contacts.slice(i, i + FETCH_BATCH);
    const chunkResults = await Promise.all(
      chunk.map(async (c) => {
        const slug = extractSlug(c.linkedinUrl);
        if (!slug) return null;

        let vetricPhotoUrl: string | null = null;
        try {
          const r = await axios.get(`${VETRIC_BASE}/profile/${slug}`, {
            headers: vetricHeaders,
            timeout: 15000,
          });
          if (r.data && r.data.message !== "Entity Not Found") {
            vetricPhotoUrl = r.data.profile_picture || null;
          }
        } catch {
          // skip
        }

        // Download both images
        const [dbImg, vetricImg] = await Promise.all([
          c.profileImageUrl ? downloadAsBase64(c.profileImageUrl) : null,
          vetricPhotoUrl ? downloadAsBase64(vetricPhotoUrl) : null,
        ]);

        return {
          contactId: c.id,
          name: c.name || "Unknown",
          company: c.company || "Unknown",
          slug,
          dbPhotoUrl: c.profileImageUrl,
          vetricPhotoUrl,
          dbImg,
          vetricImg,
        } as ContactWithPhotos;
      })
    );
    for (const r of chunkResults) {
      if (r) pairs.push(r);
    }
  }

  // Get Gemini model from DB
  const geminiModel = await getGeminiModel("image_analysis");
  const geminiKey =
    process.env.GOOGLE_AI_STUDIO || process.env.GEMINI_API_KEY || "";
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

  // Compare via Gemini in batches of 10
  const COMPARE_BATCH = 10;
  const allResults: CompareResult[] = [];

  for (let b = 0; b < pairs.length; b += COMPARE_BATCH) {
    const batch = pairs.slice(b, b + COMPARE_BATCH);

    // Only send pairs where at least one image exists
    const comparablePairs = batch.filter((p) => p.dbImg || p.vetricImg);
    if (comparablePairs.length === 0) {
      for (const p of batch) {
        allResults.push({
          contactId: p.contactId,
          name: p.name,
          company: p.company,
          slug: p.slug,
          dbPhotoUrl: p.dbPhotoUrl,
          vetricPhotoUrl: p.vetricPhotoUrl,
          verdict: "MISSING",
          reason: "Both photos missing",
        });
      }
      continue;
    }

    // Build Gemini request
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];
    let prompt =
      "Compare profile photos. For each pair, determine if Image A (our database) and Image B (LinkedIn/Vetric) show the SAME person or DIFFERENT people.\n";
    prompt +=
      "Consider facial features, gender, ethnicity, hair. Ignore background, lighting, cropping, resolution, clothing.\n";
    prompt += "If an image is missing/placeholder/silhouette, mark MISSING.\n\n";
    prompt += "Respond in EXACT format per pair:\n";
    prompt += "Pair N: MATCH | MISMATCH | MISSING - brief reason\n\n";
    parts.push({ text: prompt });

    for (let i = 0; i < comparablePairs.length; i++) {
      const p = comparablePairs[i];
      parts.push({
        text: `\n--- Pair ${i + 1}: ${p.company} / ${p.name} ---`,
      });

      if (p.dbImg) {
        parts.push({ text: "Image A (database):" });
        parts.push({
          inlineData: { mimeType: p.dbImg.mimeType, data: p.dbImg.base64 },
        });
      } else {
        parts.push({ text: "Image A: [MISSING]" });
      }

      if (p.vetricImg) {
        parts.push({ text: "Image B (LinkedIn/Vetric):" });
        parts.push({
          inlineData: {
            mimeType: p.vetricImg.mimeType,
            data: p.vetricImg.base64,
          },
        });
      } else {
        parts.push({ text: "Image B: [MISSING]" });
      }
    }

    try {
      const geminiRes = await axios.post(
        geminiUrl,
        {
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
        },
        { headers: { "Content-Type": "application/json" }, timeout: 120000 }
      );

      const text =
        geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Parse responses
      for (let i = 0; i < comparablePairs.length; i++) {
        const p = comparablePairs[i];
        const pairRegex = new RegExp(
          `Pair\\s+${i + 1}:\\s*(MATCH|MISMATCH|MISSING)\\s*[-–—]\\s*(.*)`,
          "i"
        );
        const m = text.match(pairRegex);

        allResults.push({
          contactId: p.contactId,
          name: p.name,
          company: p.company,
          slug: p.slug,
          dbPhotoUrl: p.dbPhotoUrl,
          vetricPhotoUrl: p.vetricPhotoUrl,
          verdict: m
            ? (m[1].toUpperCase() as "MATCH" | "MISMATCH" | "MISSING")
            : "ERROR",
          reason: m ? m[2].trim() : `Could not parse Gemini response for pair ${i + 1}`,
        });
      }
    } catch (err) {
      // If Gemini fails, mark all as ERROR
      for (const p of comparablePairs) {
        allResults.push({
          contactId: p.contactId,
          name: p.name,
          company: p.company,
          slug: p.slug,
          dbPhotoUrl: p.dbPhotoUrl,
          vetricPhotoUrl: p.vetricPhotoUrl,
          verdict: "ERROR",
          reason: `Gemini error: ${(err as Error).message}`,
        });
      }
    }
  }

  return NextResponse.json({ results: allResults });
}
