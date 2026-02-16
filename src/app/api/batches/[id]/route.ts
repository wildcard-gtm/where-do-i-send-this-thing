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
        include: {
          events: {
            where: { type: { in: ["tool_call_start", "tool_call_result", "decision_accepted", "complete", "error"] } },
            orderBy: { createdAt: "asc" },
            select: { type: true, data: true },
          },
          contact: {
            select: { id: true },
          },
        },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  // Transform: include parsed event data for progress tracking
  const batchResponse = {
    ...batch,
    jobs: batch.jobs.map((job) => ({
      id: job.id,
      linkedinUrl: job.linkedinUrl,
      personName: job.personName,
      status: job.status,
      recommendation: job.recommendation,
      confidence: job.confidence,
      createdAt: job.createdAt,
      contactId: job.contact?.id || null,
      stages: job.events.map((e) => ({
        type: e.type,
        toolName: (() => {
          try {
            const d = JSON.parse(e.data);
            return d.toolName || null;
          } catch {
            return null;
          }
        })(),
      })),
    })),
  };

  return NextResponse.json({ batch: batchResponse });
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
