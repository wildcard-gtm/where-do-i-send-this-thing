import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import { getGeminiModel } from "@/lib/ai/config";
import axios from "axios";

export const maxDuration = 600;

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

interface PhotoPair {
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

interface TeamMember {
  name?: string;
  photoUrl?: string;
  title?: string;
  linkedinUrl?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// POST /api/photo-fixer/compare
// Body: { batchId: string }
// Returns: SSE stream with progress events and final results
export async function POST(request: Request) {
  const user = await getSession();
  if (!user)
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

  const { batchId } = await request.json();
  if (!batchId)
    return new Response(JSON.stringify({ error: "batchId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

  const teamUserIds = await getTeamUserIds(user);

  // Get all contacts from this batch with enrichment data
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
    return new Response(JSON.stringify({ error: "Batch not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });

  const contacts = batch.jobs
    .map((j) => j.contact)
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const vetricHeaders = {
    "x-api-key": process.env.LI_API_KEY || "",
    accept: "application/json",
  };

  // Build list of all photo pairs (contacts + team members)
  interface ContactItem {
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

  const allItems: ContactItem[] = [];
  for (const c of contacts) {
    // Main contact
    allItems.push({
      contactId: c.id,
      name: c.name || "Unknown",
      company: c.company || "Unknown",
      linkedinUrl: c.linkedinUrl,
      dbPhotoUrl: c.profileImageUrl,
      type: "contact",
    });

    // Team members from enrichment
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

  const totalItems = allItems.length;

  // Stream progress via SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      send("progress", {
        phase: "init",
        message: `Found ${contacts.length} contacts, ${totalItems} total photos to check (${totalItems - contacts.length} team members)`,
        current: 0,
        total: totalItems,
      });

      // Phase 1: Fetch Vetric data + download images in batches of 20
      // Cache Vetric lookups by slug so we don't re-fetch the same person
      // (e.g. multiple contacts at same company share team members)
      const vetricCache = new Map<string, string | null>();
      const imgCache = new Map<string, { base64: string; mimeType: string } | null>();

      const pairs: PhotoPair[] = [];
      const skippedResults: CompareResultItem[] = [];
      const FETCH_BATCH = 20;
      let downloaded = 0;

      for (let i = 0; i < allItems.length; i += FETCH_BATCH) {
        const chunk = allItems.slice(i, i + FETCH_BATCH);
        send("progress", {
          phase: "downloading",
          message: `Fetching photos ${downloaded + 1}–${Math.min(downloaded + chunk.length, totalItems)} of ${totalItems}...`,
          current: downloaded,
          total: totalItems,
        });

        const chunkResults = await Promise.all(
          chunk.map(async (item) => {
            const slug = extractSlug(item.linkedinUrl);
            if (!slug) {
              return { skip: true as const, item };
            }

            // Vetric lookup (cached by slug)
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

            // Download both images (cached by URL)
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

            return {
              skip: false as const,
              pair: {
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
              } as PhotoPair,
            };
          })
        );

        for (const r of chunkResults) {
          if (r.skip) {
            skippedResults.push({
              contactId: r.item.contactId,
              name: r.item.name,
              company: r.item.company,
              slug: "",
              dbPhotoUrl: r.item.dbPhotoUrl,
              vetricPhotoUrl: null,
              verdict: "MISSING",
              reason: "No LinkedIn URL",
              type: r.item.type,
              teamMemberName: r.item.teamMemberName,
              teamMemberIndex: r.item.teamMemberIndex,
              enrichmentId: r.item.enrichmentId,
            });
          } else {
            pairs.push(r.pair);
          }
          downloaded++;
        }
      }

      send("progress", {
        phase: "downloading_done",
        message: `Downloaded ${pairs.length} photo pairs (${skippedResults.length} skipped, ${vetricCache.size} unique Vetric lookups). Starting AI comparison...`,
        current: totalItems,
        total: totalItems,
      });

      // Phase 2: Compare via Gemini in batches of 20
      const geminiModel = await getGeminiModel("image_analysis");
      const geminiKey =
        process.env.GOOGLE_AI_STUDIO || process.env.GEMINI_API_KEY || "";
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

      const COMPARE_BATCH = 20;
      const allResults: CompareResultItem[] = [];
      const totalBatches = Math.ceil(pairs.length / COMPARE_BATCH);
      let batchNum = 0;

      for (let b = 0; b < pairs.length; b += COMPARE_BATCH) {
        batchNum++;
        const batchPairs = pairs.slice(b, b + COMPARE_BATCH);

        send("progress", {
          phase: "comparing",
          message: `Comparing batch ${batchNum}/${totalBatches} (${allResults.length}/${pairs.length} done)...`,
          current: allResults.length,
          total: pairs.length,
          batchNum,
          totalBatches,
        });

        // Only send pairs where at least one image exists
        const comparablePairs = batchPairs.filter(
          (p) => p.dbImg || p.vetricImg
        );
        if (comparablePairs.length === 0) {
          for (const p of batchPairs) {
            allResults.push({
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
          continue;
        }

        // Build Gemini request
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
          parts.push({
            text: `\n--- Pair ${i + 1}: ${label} ---`,
          });

          if (p.dbImg) {
            parts.push({ text: "Image A (database):" });
            parts.push({
              inlineData: {
                mimeType: p.dbImg.mimeType,
                data: p.dbImg.base64,
              },
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
              generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
            },
            {
              headers: { "Content-Type": "application/json" },
              timeout: 120000,
            }
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
            allResults.push({
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

        // Send batch results as they come
        send("batch_results", {
          results: allResults.slice(allResults.length - batchPairs.length),
          completed: allResults.length,
          total: pairs.length,
        });
      }

      // Final done event with all results (compared + skipped)
      send("done", { results: [...allResults, ...skippedResults] });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
