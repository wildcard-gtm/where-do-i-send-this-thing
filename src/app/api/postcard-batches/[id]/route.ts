import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

// GET /api/postcard-batches/[id]
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

  const batch = await prisma.postcardBatch.findFirst({
    where: { id, userId: { in: teamUserIds } },
    include: {
      postcards: {
        include: {
          contact: { select: { id: true, name: true, linkedinUrl: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Postcard batch not found" }, { status: 404 });
  }

  // Auto-recover stale "generating" postcards (stuck > 10 min)
  const STALE_THRESHOLD = new Date(Date.now() - 10 * 60 * 1000);
  const staleReset = await prisma.postcard.updateMany({
    where: {
      postcardBatchId: id,
      status: "generating",
      updatedAt: { lt: STALE_THRESHOLD },
    },
    data: { status: "failed", errorMessage: "Timed out — generation took too long" },
  });
  if (staleReset.count > 0) {
    // Re-fetch with updated statuses
    const updated = await prisma.postcardBatch.findFirst({
      where: { id, userId: { in: teamUserIds } },
      include: {
        postcards: {
          include: {
            contact: { select: { id: true, name: true, linkedinUrl: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return NextResponse.json({ batch: updated });
  }

  return NextResponse.json({ batch });
}
