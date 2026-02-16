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
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  if (batch.status !== "processing") {
    return NextResponse.json(
      { error: "Batch is not currently processing" },
      { status: 400 }
    );
  }

  // Mark batch as cancelled — running jobs will check this flag
  await prisma.batch.update({
    where: { id },
    data: { status: "cancelled" },
  });

  // Mark any pending jobs as cancelled immediately
  await prisma.job.updateMany({
    where: { batchId: id, status: "pending" },
    data: { status: "cancelled" },
  });

  return NextResponse.json({ status: "cancelled" });
}
