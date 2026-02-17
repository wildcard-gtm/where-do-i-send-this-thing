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

  const batch = await prisma.batch.findUnique({
    where: { id },
    select: { status: true, userId: true },
  });

  if (!batch || batch.userId !== user.id) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  // Don't override if already cancelled
  if (batch.status === "cancelled") {
    return NextResponse.json({ status: "cancelled" });
  }

  const allJobs = await prisma.job.findMany({
    where: { batchId: id },
    select: { status: true },
  });

  const allDone = allJobs.every(
    (j) => j.status === "complete" || j.status === "failed" || j.status === "cancelled"
  );
  const anyFailed = allJobs.some((j) => j.status === "failed");

  if (allDone) {
    const finalStatus = anyFailed ? "failed" : "complete";
    await prisma.batch.update({
      where: { id },
      data: { status: finalStatus },
    });
    return NextResponse.json({ status: finalStatus });
  }

  return NextResponse.json({ status: "processing" });
}
