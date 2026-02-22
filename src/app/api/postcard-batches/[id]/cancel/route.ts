import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// POST /api/postcard-batches/[id]/cancel
// Marks all pending/generating postcards as cancelled and the batch as cancelled.
// The run route checks for cancellation between steps and will stop.
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
  });

  if (!batch) {
    return NextResponse.json({ error: "Postcard batch not found" }, { status: 404 });
  }

  // Mark all still-pending/generating postcards as cancelled
  await prisma.postcard.updateMany({
    where: {
      postcardBatchId: id,
      status: { in: ["pending", "generating"] },
    },
    data: { status: "cancelled", errorMessage: null },
  });

  await prisma.postcardBatch.update({
    where: { id },
    data: { status: "cancelled" },
  });

  return NextResponse.json({ cancelled: true });
}
