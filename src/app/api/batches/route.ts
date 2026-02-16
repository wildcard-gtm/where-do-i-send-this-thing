import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { urls, name, autoProcess } = await request.json();

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: "At least one URL is required" },
        { status: 400 }
      );
    }

    const batch = await prisma.batch.create({
      data: {
        userId: user.id,
        name: name || null,
        jobs: {
          create: urls.map((url: string) => ({
            linkedinUrl: url.trim(),
          })),
        },
      },
      include: { jobs: true },
    });

    // Auto-start processing if toggle is on
    if (autoProcess) {
      await prisma.batch.update({
        where: { id: batch.id },
        data: { status: "processing" },
      });

      const { processJobsSequentially } = await import(
        "@/app/api/batches/[id]/start/route"
      );

      processJobsSequentially(
        batch.id,
        user.id,
        batch.jobs.map((j) => ({ id: j.id, linkedinUrl: j.linkedinUrl, status: j.status }))
      ).catch(console.error);
    }

    return NextResponse.json({
      batchId: batch.id,
      jobCount: batch.jobs.length,
    });
  } catch (err) {
    console.error("Failed to create batch:", err);
    return NextResponse.json(
      { error: "Failed to create batch" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const batches = await prisma.batch.findMany({
    where: { userId: user.id },
    include: {
      jobs: {
        select: {
          id: true,
          status: true,
          recommendation: true,
          confidence: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ batches });
}
