import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

  const batch = await prisma.postcardBatch.findFirst({
    where: { id, userId: user.id },
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

  return NextResponse.json({ batch });
}
