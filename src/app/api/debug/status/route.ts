import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const DEBUG_KEY = process.env.DEBUG_API_KEY;

function requireKey(request: Request): boolean {
  const header = request.headers.get("x-debug-key");
  const url = new URL(request.url);
  const query = url.searchParams.get("key");
  return !!(DEBUG_KEY && (header === DEBUG_KEY || query === DEBUG_KEY));
}

// GET /api/debug/status
// Returns verbose platform status: counts, stuck jobs, enrichment states, recent errors.
// Protected by DEBUG_API_KEY header or ?key= query param.
export async function GET(request: Request) {
  if (!requireKey(request)) {
    return NextResponse.json({ error: "Unauthorized — provide x-debug-key header" }, { status: 401 });
  }

  const now = new Date();

  // ── Counts ────────────────────────────────────────────────────────────────
  const [
    userCount,
    contactCount,
    batchCount,
    jobCounts,
    enrichmentBatchCounts,
    enrichmentCounts,
    postcardCounts,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.contact.count(),
    prisma.batch.count(),
    prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.enrichmentBatch.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.companyEnrichment.groupBy({ by: ["enrichmentStatus"], _count: { _all: true } }),
    prisma.postcard.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  // ── Stuck enrichments (enriching for > 10 min) ───────────────────────────
  const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
  const stuckEnrichments = await prisma.companyEnrichment.findMany({
    where: { enrichmentStatus: "enriching", updatedAt: { lt: tenMinAgo } },
    select: {
      id: true,
      contactId: true,
      currentStep: true,
      updatedAt: true,
      enrichmentBatchId: true,
      contact: { select: { name: true } },
    },
    orderBy: { updatedAt: "asc" },
    take: 20,
  });

  // ── Stuck jobs (running for > 10 min) ────────────────────────────────────
  const stuckJobs = await prisma.job.findMany({
    where: { status: "running", updatedAt: { lt: tenMinAgo } },
    select: { id: true, batchId: true, linkedinUrl: true, status: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
    take: 20,
  });

  // ── Recent failed enrichments ─────────────────────────────────────────────
  const recentFailedEnrichments = await prisma.companyEnrichment.findMany({
    where: { enrichmentStatus: "failed" },
    select: {
      id: true,
      contactId: true,
      errorMessage: true,
      updatedAt: true,
      contact: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  // ── Recent failed jobs ────────────────────────────────────────────────────
  const recentFailedJobs = await prisma.job.findMany({
    where: { status: "failed" },
    select: { id: true, batchId: true, linkedinUrl: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  // ── Running enrichment batches ────────────────────────────────────────────
  const runningBatches = await prisma.enrichmentBatch.findMany({
    where: { status: "running" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { enrichments: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // ── Model config ──────────────────────────────────────────────────────────
  const modelConfigs = await prisma.systemPrompt.findMany({
    where: { key: { in: ["config_agent_model", "config_chat_model", "config_fallback_model"] } },
    select: { key: true, content: true },
  });

  // ── Env check (no values — just presence) ────────────────────────────────
  const envKeys = [
    "OPENAI_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "EXA_AI_KEY",
    "BRIGHT_DATA_API_KEY",
    "PDL_API_KEY",
    "SUPABASE_DB_URL",
    "JWT_SECRET",
    "DEBUG_API_KEY",
  ];
  const envStatus: Record<string, boolean> = {};
  for (const key of envKeys) {
    envStatus[key] = !!process.env[key];
  }

  return NextResponse.json({
    timestamp: now.toISOString(),
    counts: {
      users: userCount,
      contacts: contactCount,
      scanBatches: batchCount,
      jobs: Object.fromEntries(jobCounts.map((r) => [r.status, r._count._all])),
      enrichmentBatches: Object.fromEntries(enrichmentBatchCounts.map((r) => [r.status, r._count._all])),
      enrichments: Object.fromEntries(enrichmentCounts.map((r) => [r.enrichmentStatus, r._count._all])),
      postcards: Object.fromEntries(postcardCounts.map((r) => [r.status, r._count._all])),
    },
    stuck: {
      enrichments: stuckEnrichments.map((e) => ({
        id: e.id,
        contactId: e.contactId,
        contactName: e.contact.name,
        batchId: e.enrichmentBatchId,
        currentStep: e.currentStep,
        stuckSince: e.updatedAt,
        stuckMinutes: Math.round((now.getTime() - e.updatedAt.getTime()) / 60000),
      })),
      jobs: stuckJobs.map((j) => ({
        id: j.id,
        batchId: j.batchId,
        linkedinUrl: j.linkedinUrl,
        stuckSince: j.updatedAt,
        stuckMinutes: Math.round((now.getTime() - j.updatedAt.getTime()) / 60000),
      })),
    },
    recentFailures: {
      enrichments: recentFailedEnrichments.map((e) => ({
        id: e.id,
        contactName: e.contact.name,
        errorMessage: e.errorMessage,
        failedAt: e.updatedAt,
      })),
      jobs: recentFailedJobs.map((j) => ({
        id: j.id,
        linkedinUrl: j.linkedinUrl,
        failedAt: j.updatedAt,
      })),
    },
    runningBatches: runningBatches.map((b) => ({
      id: b.id,
      name: b.name,
      enrichmentCount: b._count.enrichments,
      startedAt: b.createdAt,
      lastUpdated: b.updatedAt,
      runningMinutes: Math.round((now.getTime() - b.createdAt.getTime()) / 60000),
    })),
    modelConfig: Object.fromEntries(modelConfigs.map((m) => [m.key.replace("config_", ""), m.content])),
    env: envStatus,
  });
}
