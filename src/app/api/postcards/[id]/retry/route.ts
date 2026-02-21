import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generatePostcardWithRetry } from "@/app/api/postcards/generate-bulk/route";

// POST /api/postcards/[id]/retry
// Resets a failed postcard's retryCount and re-runs generation with full retry loop.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const postcard = await prisma.postcard.findFirst({
    where: { id, contact: { userId: user.id } },
    select: { id: true, status: true },
  });

  if (!postcard) {
    return NextResponse.json({ error: "Postcard not found" }, { status: 404 });
  }

  if (postcard.status !== "failed") {
    return NextResponse.json({ error: "Only failed postcards can be retried" }, { status: 400 });
  }

  // Reset retry count so it gets a fresh 5 attempts
  await prisma.postcard.update({
    where: { id },
    data: { retryCount: 0, status: "generating", errorMessage: null },
  });

  // Fire-and-forget
  generatePostcardWithRetry(id);

  return NextResponse.json({ retrying: true, postcardId: id });
}
