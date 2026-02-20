import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

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

  const postcard = await prisma.postcard.findFirst({
    where: {
      id,
      contact: { userId: user.id },
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

  const existing = await prisma.postcard.findFirst({
    where: { id, contact: { userId: user.id } },
  });

  if (!existing) {
    return NextResponse.json({ error: "Postcard not found" }, { status: 404 });
  }

  const allowed = ["status"];
  const data: Record<string, unknown> = {};
  for (const field of allowed) {
    if (field in body) data[field] = body[field];
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

  const existing = await prisma.postcard.findFirst({
    where: { id, contact: { userId: user.id } },
  });

  if (!existing) {
    return NextResponse.json({ error: "Postcard not found" }, { status: 404 });
  }

  // Delete image files
  for (const urlField of [existing.imageUrl, existing.backgroundUrl]) {
    if (urlField) {
      const filePath = path.join(process.cwd(), "public", urlField);
      await fs.unlink(filePath).catch(() => {}); // ignore if missing
    }
  }

  await prisma.postcard.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
