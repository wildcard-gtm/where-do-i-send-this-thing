import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import { deletePostcardImage } from "@/lib/supabase-storage";

// GET — fetch postcard status (for polling)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const teamUserIds = await getTeamUserIds(user);

  const postcard = await prisma.postcard.findFirst({
    where: {
      id,
      contact: { userId: { in: teamUserIds } },
    },
  });

  if (!postcard) {
    return NextResponse.json({ error: "Postcard not found" }, { status: 404 });
  }

  return NextResponse.json({ postcard });
}

// PATCH — update status (approve/reject) or trigger regeneration
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  const teamUserIds = await getTeamUserIds(user);

  const existing = await prisma.postcard.findFirst({
    where: { id, contact: { userId: { in: teamUserIds } } },
  });

  if (!existing) {
    return NextResponse.json({ error: "Postcard not found" }, { status: 404 });
  }

  const allowed = ["status", "postcardHeadline", "postcardDescription", "accentColor", "backMessage", "backgroundPrompt"];
  const data: Record<string, unknown> = {};
  for (const field of allowed) {
    if (field in body) data[field] = body[field];
  }

  // If copy fields are being updated, reset image so regeneration picks them up
  const copyFields = ["postcardHeadline", "postcardDescription", "accentColor", "backgroundPrompt"];
  if (copyFields.some((f) => f in body)) {
    data.imageUrl = null;
    data.backgroundUrl = null;
    data.status = "pending";
    // Clean up old images from storage
    await Promise.all([
      deletePostcardImage(`backgrounds/${id}.png`),
      deletePostcardImage(`finals/${id}.png`),
    ]);
  }

  const postcard = await prisma.postcard.update({ where: { id }, data });

  return NextResponse.json({ postcard });
}

// DELETE — delete postcard + image files
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const teamUserIds = await getTeamUserIds(user);

  const existing = await prisma.postcard.findFirst({
    where: { id, contact: { userId: { in: teamUserIds } } },
  });

  if (!existing) {
    return NextResponse.json({ error: "Postcard not found" }, { status: 404 });
  }

  // Delete images from Supabase Storage
  await Promise.all([
    deletePostcardImage(`backgrounds/${id}.png`),
    deletePostcardImage(`finals/${id}.png`),
  ]);

  await prisma.postcard.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
