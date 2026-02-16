import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
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
    include: {
      jobs: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          linkedinUrl: true,
          personName: true,
          status: true,
          recommendation: true,
          confidence: true,
          createdAt: true,
        },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  return NextResponse.json({ batch });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.batch.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const body = await request.json();
  const data: Record<string, unknown> = {};
  if ("name" in body) data.name = body.name;

  const batch = await prisma.batch.update({
    where: { id },
    data,
  });

  return NextResponse.json({ batch });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.batch.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  if (existing.status === "processing") {
    return NextResponse.json(
      { error: "Cannot delete a batch that is currently processing" },
      { status: 400 }
    );
  }

  // Delete in order: events -> jobs -> batch
  await prisma.agentEvent.deleteMany({
    where: { job: { batchId: id } },
  });
  await prisma.job.deleteMany({ where: { batchId: id } });
  await prisma.batch.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
