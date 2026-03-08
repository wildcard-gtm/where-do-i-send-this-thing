import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, autoProcess } = body;

    // Support both formats:
    // { urls: string[] }                                         — backward compat
    // { entries: Array<{ url: string; csvRowData?: object }> }   — new format with CSV row data
    type Entry = { url: string; csvRowData?: Record<string, string> };
    let entries: Entry[];

    if (Array.isArray(body.entries) && body.entries.length > 0) {
      entries = body.entries;
    } else if (Array.isArray(body.urls) && body.urls.length > 0) {
      entries = body.urls.map((url: string) => ({ url }));
    } else {
      return NextResponse.json(
        { error: "At least one URL is required" },
        { status: 400 }
      );
    }

    const teamUserIds = await getTeamUserIds(user);

    const batch = await prisma.batch.create({
      data: {
        userId: user.id,
        teamId: user.teamId ?? null,
        name: name || null,
        jobs: {
          create: entries.map((entry) => ({
            linkedinUrl: entry.url.trim(),
            csvRowData: entry.csvRowData ? JSON.stringify(entry.csvRowData) : null,
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

  const teamUserIds = await getTeamUserIds(user);

  const batches = await prisma.batch.findMany({
    where: { userId: { in: teamUserIds } },
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
