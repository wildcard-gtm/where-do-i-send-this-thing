import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import { getGeminiModel } from "@/lib/ai/config";
import axios from "axios";

export const maxDuration = 120;

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
      timeout: 10000,
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

interface TeamMember {
  name?: string;
  photoUrl?: string;
  title?: string;
  linkedinUrl?: string;
}

interface CompareResultItem {
  contactId: string;
  name: string;
  company: string;
  slug: string;
  dbPhotoUrl: string | null;
  vetricPhotoUrl: string | null;
  verdict: "MATCH" | "MISMATCH" | "MISSING" | "ERROR";
  reason: string;
  type: "contact" | "team";
  teamMemberName?: string;
  teamMemberIndex?: number;
  enrichmentId?: string;
}

interface PhotoItem {
  contactId: string;
  name: string;
  company: string;
  linkedinUrl: string | null;
  dbPhotoUrl: string | null;
  type: "contact" | "team";
  teamMemberName?: string;
  teamMemberIndex?: number;
  enrichmentId?: string;
}

// POST /api/photo-fixer/compare
// Two modes:
//   { batchId: string }                    → returns item list + total count (phase 1)
//   { batchId: string, items: PhotoItem[], offset: number } → compares one chunk (phase 2)
export async function POST(request: Request) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const { batchId } = body;
  if (!batchId)
    return NextResponse.json({ error: "batchId required" }, { status: 400 });

  const teamUserIds = await getTeamUserIds(user);

  // Phase 2: Compare a chunk of items
  if (body.items && Array.isArray(body.items)) {
    return compareChunk(body.items as PhotoItem[], body.offset || 0);
  }

  // Phase 1: Build item list from batch
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
              companyEnrichments: {
                where: { isLatest: true },
                take: 1,
                select: {
                  id: true,
                  teamPhotos: true,
                },
              },
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

  const allItems: PhotoItem[] = [];
  for (const c of contacts) {
    allItems.push({
      contactId: c.id,
      name: c.name || "Unknown",
      company: c.company || "Unknown",
      linkedinUrl: c.linkedinUrl,
      dbPhotoUrl: c.profileImageUrl,
      type: "contact",
    });

    const enrichment = c.companyEnrichments[0];
    if (enrichment?.teamPhotos) {
      const members = enrichment.teamPhotos as TeamMember[];
      if (Array.isArray(members)) {
        members.forEach((m, idx) => {
          if (m.linkedinUrl) {
            allItems.push({
              contactId: c.id,
              name: m.name || `Team Member ${idx + 1}`,
              company: c.company || "Unknown",
              linkedinUrl: m.linkedinUrl,
              dbPhotoUrl: m.photoUrl || null,
              type: "team",
              teamMemberName: m.name || `Team Member ${idx + 1}`,
              teamMemberIndex: idx,
              enrichmentId: enrichment.id,
            });
          }
        });
      }
    }
  }

  return NextResponse.json({
    phase: "items",
    items: allItems,
    totalContacts: contacts.length,
    totalItems: allItems.length,
    totalTeam: allItems.length - contacts.length,
  });
}

// Compare one chunk of items: fetch Vetric + download images + Gemini comparison
async function compareChunk(items: PhotoItem[], offset: number) {
  const vetricHeaders = {
    "x-api-key": process.env.LI_API_KEY || "",
    accept: "application/json",
  };

  // Dedupe Vetric lookups within this chunk
  const vetricCache = new Map<string, string | null>();
  const imgCache = new Map<string, { base64: string; mimeType: string } | null>();

  interface PairData {
    contactId: string;
    name: string;
    company: string;
    slug: string;
    dbPhotoUrl: string | null;
    vetricPhotoUrl: string | null;
    dbImg: { base64: string; mimeType: string } | null;
    vetricImg: { base64: string; mimeType: string } | null;
    type: "contact" | "team";
    teamMemberName?: string;
    teamMemberIndex?: number;
    enrichmentId?: string;
  }

  const pairs: PairData[] = [];
  const skipped: CompareResultItem[] = [];

  // Download all photos in this chunk concurrently
  await Promise.all(
    items.map(async (item) => {
      const slug = extractSlug(item.linkedinUrl);
      if (!slug) {
        skipped.push({
          contactId: item.contactId,
          name: item.name,
          company: item.company,
          slug: "",
          dbPhotoUrl: item.dbPhotoUrl,
          vetricPhotoUrl: null,
          verdict: "MISSING",
          reason: "No LinkedIn URL",
          type: item.type,
          teamMemberName: item.teamMemberName,
          teamMemberIndex: item.teamMemberIndex,
          enrichmentId: item.enrichmentId,
        });
        return;
      }

      // Vetric lookup (cached)
      let vetricPhotoUrl: string | null = null;
      if (vetricCache.has(slug)) {
        vetricPhotoUrl = vetricCache.get(slug) ?? null;
      } else {
        try {
          const r = await axios.get(`${VETRIC_BASE}/profile/${slug}`, {
            headers: vetricHeaders,
            timeout: 10000,
          });
          if (r.data && r.data.message !== "Entity Not Found") {
            vetricPhotoUrl = r.data.profile_picture || null;
          }
        } catch {
          // skip
        }
        vetricCache.set(slug, vetricPhotoUrl);
      }

      // Download images (cached)
      async function getImg(url: string | null) {
        if (!url) return null;
        if (imgCache.has(url)) return imgCache.get(url) ?? null;
        const img = await downloadAsBase64(url);
        imgCache.set(url, img);
        return img;
      }

      const [dbImg, vetricImg] = await Promise.all([
        getImg(item.dbPhotoUrl),
        getImg(vetricPhotoUrl),
      ]);

      pairs.push({
        contactId: item.contactId,
        name: item.name,
        company: item.company,
        slug,
        dbPhotoUrl: item.dbPhotoUrl,
        vetricPhotoUrl,
        dbImg,
        vetricImg,
        type: item.type,
        teamMemberName: item.teamMemberName,
        teamMemberIndex: item.teamMemberIndex,
        enrichmentId: item.enrichmentId,
      });
    })
  );

  // Gemini comparison for all pairs in this chunk (single call)
  const comparablePairs = pairs.filter((p) => p.dbImg || p.vetricImg);
  const results: CompareResultItem[] = [...skipped];

  // Add missing pairs (no images at all)
  for (const p of pairs) {
    if (!p.dbImg && !p.vetricImg) {
      results.push({
        contactId: p.contactId,
        name: p.name,
        company: p.company,
        slug: p.slug,
        dbPhotoUrl: p.dbPhotoUrl,
        vetricPhotoUrl: p.vetricPhotoUrl,
        verdict: "MISSING",
        reason: "Both photos missing",
        type: p.type,
        teamMemberName: p.teamMemberName,
        teamMemberIndex: p.teamMemberIndex,
        enrichmentId: p.enrichmentId,
      });
    }
  }

  if (comparablePairs.length === 0) {
    return NextResponse.json({ phase: "chunk", offset, results });
  }

  const geminiModel = await getGeminiModel("image_analysis");
  const geminiKey =
    process.env.GOOGLE_AI_STUDIO || process.env.GEMINI_API_KEY || "";
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];
  let prompt =
    "Compare profile photos. For each pair, determine if Image A (our database) and Image B (LinkedIn/Vetric) show the SAME person or DIFFERENT people.\n";
  prompt +=
    "Consider facial features, gender, ethnicity, hair. Ignore background, lighting, cropping, resolution, clothing.\n";
  prompt +=
    "If an image is missing/placeholder/silhouette, mark MISSING.\n\n";
  prompt += "Respond in EXACT format per pair:\n";
  prompt += "Pair N: MATCH | MISMATCH | MISSING - brief reason\n\n";
  parts.push({ text: prompt });

  for (let i = 0; i < comparablePairs.length; i++) {
    const p = comparablePairs[i];
    const label =
      p.type === "team"
        ? `${p.company} / Team: ${p.teamMemberName}`
        : `${p.company} / ${p.name}`;
    parts.push({ text: `\n--- Pair ${i + 1}: ${label} ---` });

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
        inlineData: { mimeType: p.vetricImg.mimeType, data: p.vetricImg.base64 },
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
        generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
      },
      { headers: { "Content-Type": "application/json" }, timeout: 90000 }
    );

    const text =
      geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    for (let i = 0; i < comparablePairs.length; i++) {
      const p = comparablePairs[i];
      const pairRegex = new RegExp(
        `Pair\\s+${i + 1}:\\s*(MATCH|MISMATCH|MISSING)\\s*[-–—]\\s*(.*)`,
        "i"
      );
      const m = text.match(pairRegex);

      results.push({
        contactId: p.contactId,
        name: p.name,
        company: p.company,
        slug: p.slug,
        dbPhotoUrl: p.dbPhotoUrl,
        vetricPhotoUrl: p.vetricPhotoUrl,
        verdict: m
          ? (m[1].toUpperCase() as "MATCH" | "MISMATCH" | "MISSING")
          : "ERROR",
        reason: m
          ? m[2].trim()
          : `Could not parse Gemini response for pair ${i + 1}`,
        type: p.type,
        teamMemberName: p.teamMemberName,
        teamMemberIndex: p.teamMemberIndex,
        enrichmentId: p.enrichmentId,
      });
    }
  } catch (err) {
    for (const p of comparablePairs) {
      results.push({
        contactId: p.contactId,
        name: p.name,
        company: p.company,
        slug: p.slug,
        dbPhotoUrl: p.dbPhotoUrl,
        vetricPhotoUrl: p.vetricPhotoUrl,
        verdict: "ERROR",
        reason: `Gemini error: ${(err as Error).message}`,
        type: p.type,
        teamMemberName: p.teamMemberName,
        teamMemberIndex: p.teamMemberIndex,
        enrichmentId: p.enrichmentId,
      });
    }
  }

  return NextResponse.json({ phase: "chunk", offset, results });
}
