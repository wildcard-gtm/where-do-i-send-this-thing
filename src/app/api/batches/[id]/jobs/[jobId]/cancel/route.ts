import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

// POST /api/batches/[id]/jobs/[jobId]/cancel
// Cancels a single scan job.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id, jobId } = await params;
  const teamUserIds = await getTeamUserIds(user);

  const batch = await prisma.batch.findFirst({
    where: { id, userId: { in: teamUserIds } },
    select: { id: true },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, batchId: id },
    select: { id: true, status: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "running" && job.status !== "pending") {
    return NextResponse.json({ error: "Job is not in a cancellable state" }, { status: 409 });
  }

  await prisma.job.update({
    where: { id: jobId },
    data: { status: "cancelled" },
  });

  return NextResponse.json({ success: true });
}
