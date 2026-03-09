import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import { uploadReferenceImage } from "@/lib/supabase-storage";

interface TeamPhoto {
  name?: string;
  photoUrl: string;
  title?: string;
}

// PATCH /api/enrichments/[id]/team-member
// Update a single team member in the enrichment's teamPhotos JSON array.
// Accepts multipart form data with optional file upload, or JSON body.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const teamUserIds = await getTeamUserIds(user);

  const enrichment = await prisma.companyEnrichment.findFirst({
    where: { id, contact: { userId: { in: teamUserIds } } },
    select: { id: true, teamPhotos: true },
  });

  if (!enrichment)
    return NextResponse.json(
      { error: "Enrichment not found" },
      { status: 404 }
    );

  const contentType = request.headers.get("content-type") || "";
  let index: number;
  let name: string | undefined;
  let title: string | undefined;
  let photoFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    index = parseInt(formData.get("index") as string);
    const n = formData.get("name") as string | null;
    const t = formData.get("title") as string | null;
    if (n !== null) name = n;
    if (t !== null) title = t;
    photoFile = formData.get("photo") as File | null;
  } else {
    const body = await request.json();
    index = body.index;
    name = body.name;
    title = body.title;
  }

  const photos = (enrichment.teamPhotos as TeamPhoto[] | null) ?? [];
  if (isNaN(index) || index < 0 || index >= photos.length) {
    return NextResponse.json(
      { error: "Invalid team member index" },
      { status: 400 }
    );
  }

  // Update text fields
  if (name !== undefined) photos[index].name = name;
  if (title !== undefined) photos[index].title = title;

  // Upload new photo if provided
  if (photoFile && photoFile.size > 0) {
    const buffer = Buffer.from(await photoFile.arrayBuffer());
    const ext = photoFile.name.split(".").pop() || "png";
    const filePath = `team-photos/${id}/${index}-${Date.now()}.${ext}`;
    const publicUrl = await uploadReferenceImage(
      buffer,
      filePath,
      photoFile.type || "image/png"
    );
    photos[index].photoUrl = publicUrl;
  }

  await prisma.companyEnrichment.update({
    where: { id },
    data: { teamPhotos: photos as unknown as import("@prisma/client").Prisma.InputJsonValue },
  });

  return NextResponse.json({ teamPhotos: photos });
}

// POST /api/enrichments/[id]/team-member
// Add a new team member to the enrichment's teamPhotos array.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const teamUserIds = await getTeamUserIds(user);

  const enrichment = await prisma.companyEnrichment.findFirst({
    where: { id, contact: { userId: { in: teamUserIds } } },
    select: { id: true, teamPhotos: true },
  });

  if (!enrichment)
    return NextResponse.json({ error: "Enrichment not found" }, { status: 404 });

  const contentType = request.headers.get("content-type") || "";
  let name = "";
  let title = "";
  let photoFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    name = (formData.get("name") as string) || "";
    title = (formData.get("title") as string) || "";
    photoFile = formData.get("photo") as File | null;
  } else {
    const body = await request.json();
    name = body.name || "";
    title = body.title || "";
  }

  let photoUrl = "";
  if (photoFile && photoFile.size > 0) {
    const buffer = Buffer.from(await photoFile.arrayBuffer());
    const ext = photoFile.name.split(".").pop() || "png";
    const photos = (enrichment.teamPhotos as TeamPhoto[] | null) ?? [];
    const filePath = `team-photos/${id}/${photos.length}-${Date.now()}.${ext}`;
    photoUrl = await uploadReferenceImage(buffer, filePath, photoFile.type || "image/png");
  }

  const photos = (enrichment.teamPhotos as TeamPhoto[] | null) ?? [];
  photos.push({ name, title, photoUrl });

  await prisma.companyEnrichment.update({
    where: { id },
    data: { teamPhotos: photos as unknown as import("@prisma/client").Prisma.InputJsonValue },
  });

  return NextResponse.json({ teamPhotos: photos });
}

// DELETE /api/enrichments/[id]/team-member
// Remove a team member by index from the enrichment's teamPhotos array.
// Body: { index: number }
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const teamUserIds = await getTeamUserIds(user);

  const enrichment = await prisma.companyEnrichment.findFirst({
    where: { id, contact: { userId: { in: teamUserIds } } },
    select: { id: true, teamPhotos: true },
  });

  if (!enrichment)
    return NextResponse.json({ error: "Enrichment not found" }, { status: 404 });

  const body = await request.json();
  const index = body.index;
  const photos = (enrichment.teamPhotos as TeamPhoto[] | null) ?? [];

  if (typeof index !== "number" || index < 0 || index >= photos.length) {
    return NextResponse.json({ error: "Invalid index" }, { status: 400 });
  }

  photos.splice(index, 1);

  await prisma.companyEnrichment.update({
    where: { id },
    data: { teamPhotos: photos as unknown as import("@prisma/client").Prisma.InputJsonValue },
  });

  return NextResponse.json({ teamPhotos: photos });
}
