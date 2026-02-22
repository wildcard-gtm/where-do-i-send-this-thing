import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/postcard-batches
export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const batches = await prisma.postcardBatch.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      postcards: { select: { status: true } },
    },
  });

  const result = batches.map((batch) => ({
    id: batch.id,
    name: batch.name,
    status: batch.status,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    total: batch.postcards.length,
    ready: batch.postcards.filter((p) => p.status === "ready" || p.status === "approved").length,
    failed: batch.postcards.filter((p) => p.status === "failed").length,
    generating: batch.postcards.filter((p) => p.status === "generating").length,
  }));

  return NextResponse.json({ batches: result });
}
