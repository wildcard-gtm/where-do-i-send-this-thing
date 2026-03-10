import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import { deletePostcardImage } from "@/lib/supabase-storage";

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

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

  let postcard = await prisma.postcard.findFirst({
    where: {
      id,
      contact: { userId: { in: teamUserIds } },
    },
    include: {
      contact: {
        select: {
          id: true, name: true, company: true, title: true, linkedinUrl: true, profileImageUrl: true,
          companyEnrichments: {
            where: { isLatest: true },
            take: 1,
          },
        },
      },
    },
  });

  if (!postcard) {
    return NextResponse.json({ error: "Postcard not found" }, { status: 404 });
  }

  // Auto-recover stale "generating" postcards (stuck > 10 min)
  if (
    postcard.status === "generating" &&
    Date.now() - postcard.updatedAt.getTime() > STALE_THRESHOLD_MS
  ) {
    postcard = await prisma.postcard.update({
      where: { id },
      data: { status: "failed", errorMessage: "Timed out — generation took too long" },
      include: {
        contact: {
          select: {
            id: true, name: true, company: true, title: true, linkedinUrl: true, profileImageUrl: true,
            companyEnrichments: {
              where: { isLatest: true },
              take: 1,
            },
          },
        },
      },
    });
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

  const allowed = ["status", "backMessage"];
  const data: Record<string, unknown> = {};
  for (const field of allowed) {
    if (field in body) data[field] = body[field];
  }

  const postcard = await prisma.postcard.update({ where: { id }, data });

  // If cancelled, check if the entire batch is now done
  if (body.status === "cancelled" && postcard.postcardBatchId) {
    const remaining = await prisma.postcard.count({
      where: { postcardBatchId: postcard.postcardBatchId, status: { in: ["pending", "generating"] } },
    });
    if (remaining === 0) {
      const failedCount = await prisma.postcard.count({
        where: { postcardBatchId: postcard.postcardBatchId, status: "failed" },
      });
      const cancelledCount = await prisma.postcard.count({
        where: { postcardBatchId: postcard.postcardBatchId, status: "cancelled" },
      });
      const batchStatus = failedCount > 0 ? "failed" : cancelledCount > 0 ? "cancelled" : "complete";
      await prisma.postcardBatch.update({
        where: { id: postcard.postcardBatchId },
        data: { status: batchStatus },
      });
    }
  }

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
