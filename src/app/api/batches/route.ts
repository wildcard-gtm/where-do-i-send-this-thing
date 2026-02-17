import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { urls, name, autoProcess, skipDuplicateCheck } = await request.json();

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: "At least one URL is required" },
        { status: 400 }
      );
    }

    // Check for existing contacts with these URLs
    if (!skipDuplicateCheck) {
      const existing = await prisma.contact.findMany({
        where: {
          userId: user.id,
          linkedinUrl: { in: urls.map((u: string) => u.trim()) },
        },
        select: { linkedinUrl: true, name: true, recommendation: true, lastScannedAt: true },
      });

      if (existing.length > 0) {
        return NextResponse.json({
          duplicates: existing,
          totalUrls: urls.length,
          newUrls: urls.length - existing.length,
        }, { status: 409 });
      }
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
      include: { jobs: { orderBy: { createdAt: "asc" } } },
    });

    // Auto-start processing if toggle is on
    if (autoProcess) {
      await prisma.batch.update({
        where: { id: batch.id },
        data: { status: "processing" },
      });
    }

    return NextResponse.json({
      batchId: batch.id,
      jobCount: batch.jobs.length,
      autoProcess: !!autoProcess,
      jobIds: autoProcess ? batch.jobs.map((j) => j.id) : undefined,
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
