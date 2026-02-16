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
    include: { jobs: true },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  if (batch.status === "processing") {
    return NextResponse.json(
      { error: "Stop the batch first before restarting" },
      { status: 400 }
    );
  }

  // Clear all events for all jobs in this batch
  await prisma.agentEvent.deleteMany({
    where: { job: { batchId: id } },
  });

  // Reset all jobs to pending
  await prisma.job.updateMany({
    where: { batchId: id },
    data: {
      status: "pending",
      recommendation: null,
      confidence: null,
      result: null,
      personName: null,
    },
  });

  // Reset batch to pending
  await prisma.batch.update({
    where: { id },
    data: { status: "pending" },
  });

  return NextResponse.json({ status: "reset" });
}
