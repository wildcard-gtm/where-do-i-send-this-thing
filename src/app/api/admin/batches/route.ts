import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const user = await getSession();
  if (!user) return null;
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (dbUser?.role !== "admin") return null;
  return user;
}

export async function GET() {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const batches = await prisma.batch.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, email: true } },
      _count: { select: { jobs: true } },
      jobs: { select: { status: true } },
    },
  });

  const result = batches.map((b) => {
    const completed = b.jobs.filter((j) => j.status === "complete").length;
    const failed = b.jobs.filter((j) => j.status === "failed").length;
    return {
      id: b.id,
      name: b.name,
      status: b.status,
      createdAt: b.createdAt,
      user: b.user,
      totalJobs: b._count.jobs,
      completed,
      failed,
    };
  });

  return NextResponse.json({ batches: result });
}
