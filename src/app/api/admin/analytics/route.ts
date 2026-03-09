import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/admin/analytics
export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (dbUser?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Summary cards: calls today, errors today, tokens today
  const [callsToday, errorsToday] = await Promise.all([
    prisma.appLog.count({
      where: { createdAt: { gte: todayStart } },
    }),
    prisma.appLog.count({
      where: { createdAt: { gte: todayStart }, level: "error" },
    }),
  ]);

  const errorRate = callsToday > 0 ? Math.round((errorsToday / callsToday) * 100) : 0;

  // Token usage today — aggregate from meta JSON
  const tokensResult = await prisma.$queryRaw<
    Array<{ input_tokens: string | null; output_tokens: string | null }>
  >`
    SELECT
      SUM(COALESCE((meta->>'inputTokens')::bigint, 0)) as input_tokens,
      SUM(COALESCE((meta->>'outputTokens')::bigint, 0)) as output_tokens
    FROM "AppLog"
    WHERE "createdAt" >= ${todayStart}
      AND meta IS NOT NULL
  `;

  const inputTokensToday = Number(tokensResult[0]?.input_tokens ?? 0);
  const outputTokensToday = Number(tokensResult[0]?.output_tokens ?? 0);
  const totalTokensToday = inputTokensToday + outputTokensToday;

  // Daily breakdown for last 7 days
  const dailyBreakdown = await prisma.$queryRaw<
    Array<{
      day: string;
      source: string;
      calls: string;
      errors: string;
      input_tokens: string;
      output_tokens: string;
    }>
  >`
    SELECT
      TO_CHAR("createdAt"::date, 'YYYY-MM-DD') as day,
      source,
      COUNT(*)::text as calls,
      COUNT(*) FILTER (WHERE level = 'error')::text as errors,
      COALESCE(SUM((meta->>'inputTokens')::bigint), 0)::text as input_tokens,
      COALESCE(SUM((meta->>'outputTokens')::bigint), 0)::text as output_tokens
    FROM "AppLog"
    WHERE "createdAt" >= ${sevenDaysAgo}
    GROUP BY "createdAt"::date, source
    ORDER BY day DESC, source
  `;

  return NextResponse.json({
    summary: {
      callsToday,
      errorsToday,
      errorRate,
      totalTokensToday,
      inputTokensToday,
      outputTokensToday,
    },
    daily: dailyBreakdown.map((row) => ({
      day: row.day,
      source: row.source,
      calls: Number(row.calls),
      errors: Number(row.errors),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
    })),
  });
}
