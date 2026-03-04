import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const SERVICES = [
  "gemini",
  "openai",
  "bedrock",
  "bright_data",
  "endato",
  "propmix",
  "exa_ai",
  "supabase",
  "system",
] as const;

// GET /api/admin/status
export async function GET() {
  const user = await getSession();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const services = await Promise.all(
    SERVICES.map(async (source) => {
      const [lastLog, lastSuccess, lastError, recentLogs] = await Promise.all([
        prisma.appLog.findFirst({
          where: { source },
          orderBy: { createdAt: "desc" },
        }),
        prisma.appLog.findFirst({
          where: { source, level: "info" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        prisma.appLog.findFirst({
          where: { source, level: "error" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true, message: true },
        }),
        prisma.appLog.findMany({
          where: { source },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      ]);

      let status: "ok" | "error" | "unknown" = "unknown";
      if (lastLog) {
        status = lastLog.level === "error" ? "error" : "ok";
      }

      return {
        source,
        status,
        lastSuccess: lastSuccess?.createdAt ?? null,
        lastError: lastError
          ? { time: lastError.createdAt, message: lastError.message }
          : null,
        recentLogs,
      };
    })
  );

  return NextResponse.json({ services });
}
