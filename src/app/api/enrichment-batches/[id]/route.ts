import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/enrichment-batches/[id]
// Returns a single enrichment batch with all its enrichment records and contact names
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const batch = await prisma.enrichmentBatch.findFirst({
    where: { id, userId: user.id },
    include: {
      enrichments: {
        orderBy: { createdAt: "asc" },
        include: {
          contact: {
            select: { id: true, name: true, linkedinUrl: true },
          },
        },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Enrichment batch not found" }, { status: 404 });
  }

  return NextResponse.json({ batch });
}
