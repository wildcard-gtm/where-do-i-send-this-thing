import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const batch = await prisma.batch.findFirst({
    where: { id, userId: user.id },
    include: { jobs: { orderBy: { createdAt: "asc" }, select: { id: true, status: true } } },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  if (batch.status === "processing") {
    return NextResponse.json(
      { error: "Batch is already processing" },
      { status: 400 }
    );
  }

  // Mark batch as processing
  await prisma.batch.update({
    where: { id },
    data: { status: "processing" },
  });

  // Return pending job IDs in order so the frontend can dispatch them
  const pendingJobIds = batch.jobs
    .filter((j) => j.status === "pending")
    .map((j) => j.id);

  return NextResponse.json({ status: "started", jobIds: pendingJobIds });
}
