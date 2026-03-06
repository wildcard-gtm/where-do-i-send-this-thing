import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPlaceholderUrl } from "@/lib/photo-finder/detect-placeholder";

// POST /api/photos/upload
// Body: { key, type, contactId, enrichmentId?, teamIndex?, photoUrl }
// Downloads the photo from photoUrl, uploads to Supabase, updates DB
export async function POST(request: Request) {
  const body = await request.json();
  const { key, type, contactId, enrichmentId, teamIndex, photoUrl } = body;

  if (!key || key !== process.env.DEBUG_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!photoUrl || !contactId) {
    return NextResponse.json({ error: "Missing photoUrl or contactId" }, { status: 400 });
  }

  // Verify it's not a placeholder
  if (isPlaceholderUrl(photoUrl)) {
    return NextResponse.json({ error: "Photo URL is a placeholder", photoUrl }, { status: 400 });
  }

  try {
    // Download the image
    const imgRes = await fetch(photoUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!imgRes.ok) {
      return NextResponse.json({ error: `Failed to download: ${imgRes.status}` }, { status: 400 });
    }

    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    // Skip tiny images (likely placeholders)
    if (buffer.length < 3000) {
      return NextResponse.json({ error: "Image too small, likely placeholder" }, { status: 400 });
    }

    // Upload to Supabase Storage
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    const ext = contentType.includes("png") ? "png" : "jpg";
    const filename = `photos/${type}-${contactId}-${Date.now()}.${ext}`;
    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/postcards/${filename}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      return NextResponse.json({ error: `Supabase upload failed: ${uploadRes.status}` }, { status: 500 });
    }

    const uploadedUrl = `${supabaseUrl}/storage/v1/object/public/postcards/${filename}`;

    // Update DB
    if (type === "contact") {
      await prisma.contact.update({
        where: { id: contactId },
        data: { profileImageUrl: uploadedUrl },
      });
    } else if (type === "team" && enrichmentId != null && teamIndex != null) {
      const enrichment = await prisma.companyEnrichment.findUnique({
        where: { id: enrichmentId },
        select: { teamPhotos: true },
      });
      if (enrichment?.teamPhotos && Array.isArray(enrichment.teamPhotos)) {
        const photos = [...enrichment.teamPhotos] as Array<Record<string, unknown>>;
        if (photos[teamIndex]) {
          photos[teamIndex] = { ...photos[teamIndex], photoUrl: uploadedUrl };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await prisma.companyEnrichment.update({
            where: { id: enrichmentId },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: { teamPhotos: photos as any },
          });
        }
      }
    }

    return NextResponse.json({ success: true, uploadedUrl, type, contactId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
