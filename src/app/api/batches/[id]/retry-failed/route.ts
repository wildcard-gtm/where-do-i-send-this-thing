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
    include: { jobs: { orderBy: { createdAt: "asc" } } },
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

  const failedJobs = batch.jobs.filter(
    (j) => j.status === "failed" || j.status === "cancelled"
  );

  if (failedJobs.length === 0) {
    return NextResponse.json(
      { error: "No failed jobs to retry" },
      { status: 400 }
    );
  }

  // Clear events and reset failed/cancelled jobs to pending
  await prisma.agentEvent.deleteMany({
    where: { jobId: { in: failedJobs.map((j) => j.id) } },
  });

  await prisma.job.updateMany({
    where: { id: { in: failedJobs.map((j) => j.id) } },
    data: {
      status: "pending",
      recommendation: null,
      confidence: null,
      result: null,
      personName: null,
    },
  });

  // Mark batch as processing
  await prisma.batch.update({
    where: { id },
    data: { status: "processing" },
  });

  // Return job IDs for frontend to dispatch
  const jobIds = failedJobs.map((j) => j.id);

  return NextResponse.json({ status: "retrying", jobIds });
}
