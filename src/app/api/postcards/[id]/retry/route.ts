import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const maxDuration = 300;

// POST /api/postcards/[id]/retry
// Resets a failed postcard's retryCount to 0 and status to "pending".
// Returns the postcardId so the caller can dispatch POST /api/postcards/[id]/run.
// (The postcard detail page calls /run itself after this resets the record.)
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
    data: { retryCount: 0, status: "pending", errorMessage: null },
  });

  return NextResponse.json({ retrying: true, postcardId: id });
}
