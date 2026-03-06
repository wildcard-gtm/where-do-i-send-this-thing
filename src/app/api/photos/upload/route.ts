import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// POST /api/photos/upload
// Body: { key, type, contactId, enrichmentId?, teamIndex?, imageBase64, contentType? }
// Accepts base64 image data from the Chrome extension, uploads to Supabase Storage, updates DB
export async function POST(request: Request) {
  const body = await request.json();
  const { key, type, contactId, enrichmentId, teamIndex, imageBase64, contentType: ct } = body;

  if (!key || key !== process.env.DEBUG_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!imageBase64 || !contactId) {
    return NextResponse.json({ error: "Missing imageBase64 or contactId" }, { status: 400 });
  }

  try {
    const contentType = ct || "image/jpeg";
    const buffer = Buffer.from(imageBase64, "base64");

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
      const errText = await uploadRes.text().catch(() => "");
      return NextResponse.json({ error: `Supabase upload failed: ${uploadRes.status} ${errText}` }, { status: 500 });
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
