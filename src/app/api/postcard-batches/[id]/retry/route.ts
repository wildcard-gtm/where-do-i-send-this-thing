import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// POST /api/postcard-batches/[id]/retry
// Resets all failed/cancelled postcards to pending and returns their IDs.
// The browser (postcard batch detail page) dispatches individual run calls.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const batch = await prisma.postcardBatch.findFirst({
    where: { id, userId: user.id },
    include: {
      postcards: {
        where: { status: { in: ["failed", "cancelled"] } },
        select: { id: true },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  if (batch.postcards.length === 0) {
    return NextResponse.json({ error: "No failed postcards to retry" }, { status: 400 });
  }

  const ids = batch.postcards.map((p) => p.id);

  // Reset to pending with fresh retry budget
  await prisma.postcard.updateMany({
    where: { id: { in: ids } },
    data: { retryCount: 0, status: "pending", errorMessage: null },
  });

  await prisma.postcardBatch.update({
    where: { id },
    data: { status: "running" },
  });

  return NextResponse.json({ postcardIds: ids, retrying: ids.length });
}
