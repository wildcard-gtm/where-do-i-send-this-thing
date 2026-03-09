import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/admin/logs?cursor=X&search=Y&level=Z&source=W
export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (dbUser?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const search = url.searchParams.get("search");
  const level = url.searchParams.get("level");
  const source = url.searchParams.get("source");

  const PAGE_SIZE = 1000;

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (level) where.level = level;
  if (source) where.source = source;
  if (search) {
    where.message = { contains: search, mode: "insensitive" };
  }

  const logs = await prisma.appLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    ...(cursor
      ? { cursor: { id: cursor }, skip: 1 }
      : {}),
  });

  const hasMore = logs.length > PAGE_SIZE;
  const results = hasMore ? logs.slice(0, PAGE_SIZE) : logs;
  const nextCursor = hasMore ? results[results.length - 1].id : null;

  // Get distinct filter values
  const [sources, levels] = await Promise.all([
    prisma.appLog.findMany({ select: { source: true }, distinct: ["source"] }),
    prisma.appLog.findMany({ select: { level: true }, distinct: ["level"] }),
  ]);

  return NextResponse.json({
    logs: results,
    nextCursor,
    filters: {
      sources: sources.map((s) => s.source),
      levels: levels.map((l) => l.level),
    },
  });
}
