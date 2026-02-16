import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id, jobId } = await params;

  // Verify batch belongs to user
  const batch = await prisma.batch.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, batchId: id },
    include: {
      events: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    job: {
      ...job,
      result: job.result ? JSON.parse(job.result) : null,
      events: job.events.map((e) => ({
        id: e.id,
        type: e.type,
        iteration: e.iteration,
        data: JSON.parse(e.data),
        createdAt: e.createdAt,
      })),
    },
  });
}
