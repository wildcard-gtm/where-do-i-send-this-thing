import { NextResponse } from "next/server";
import { appLog } from "@/lib/app-log";
import { prisma } from "@/lib/db";

// GET /api/cron/health-check
// Lightweight pings to external services, logs results via appLog().
// Auth: CRON_SECRET header (Vercel auto-provides for crons).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, string> = {};

  // 1. Supabase: SELECT 1
  try {
    await prisma.$queryRaw`SELECT 1`;
    await appLog("info", "supabase", "health_check", "Database connection OK");
    results.supabase = "ok";
  } catch (err) {
    await appLog("error", "supabase", "health_check", `Database connection failed: ${(err as Error).message}`);
    results.supabase = "error";
  }

  // 2. Gemini: list models
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_STUDIO;
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (res.ok) {
        await appLog("info", "gemini", "health_check", "Gemini API reachable");
        results.gemini = "ok";
      } else {
        await appLog("error", "gemini", "health_check", `Gemini API returned ${res.status}`);
        results.gemini = "error";
      }
    } catch (err) {
      await appLog("error", "gemini", "health_check", `Gemini API unreachable: ${(err as Error).message}`);
      results.gemini = "error";
    }
  } else {
    results.gemini = "no_key";
  }

  // 3. OpenAI: list models
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/models?limit=1", {
        headers: { Authorization: `Bearer ${openaiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        await appLog("info", "openai", "health_check", "OpenAI API reachable");
        results.openai = "ok";
      } else {
        await appLog("error", "openai", "health_check", `OpenAI API returned ${res.status}`);
        results.openai = "error";
      }
    } catch (err) {
      await appLog("error", "openai", "health_check", `OpenAI API unreachable: ${(err as Error).message}`);
      results.openai = "error";
    }
  } else {
    results.openai = "no_key";
  }

  // 4. Bedrock: check env vars
  const hasAws = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_REGION);
  if (hasAws) {
    await appLog("info", "bedrock", "health_check", "AWS Bedrock credentials configured");
    results.bedrock = "ok";
  } else {
    await appLog("warn", "bedrock", "health_check", "AWS Bedrock credentials missing");
    results.bedrock = "no_credentials";
  }

  return NextResponse.json({ results, timestamp: new Date().toISOString() });
}
