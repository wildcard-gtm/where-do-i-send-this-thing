import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/campaigns/[id]
// Returns a unified per-contact view of one campaign across all 3 stages:
// scan (Job) → enrichment (CompanyEnrichment) → postcard (Postcard)
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
            where: {
              type: {
                in: ["tool_call_start", "tool_call_result", "decision_accepted", "complete", "error"],
              },
            },
            orderBy: { createdAt: "asc" },
            select: { type: true, data: true },
          },
          contact: {
            select: {
              id: true,
              name: true,
              title: true,
              enrichments: {
                where: { isLatest: true },
                take: 1,
                select: {
                  id: true,
                  enrichmentBatchId: true,
                  enrichmentStatus: true,
                  currentStep: true,
                  errorMessage: true,
                  retryCount: true,
                },
              },
              postcards: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  postcardBatchId: true,
                  status: true,
                },
              },
            },
          },
        },
      },
      enrichmentBatches: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
      postcardBatches: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const contacts = batch.jobs.map((job) => {
    const contact = job.contact ?? null;
    const enrichment = contact?.enrichments[0] ?? null;
    const postcard = contact?.postcards[0] ?? null;

    const stages = job.events.map((e) => ({
      type: e.type,
      toolName: (() => {
        try {
          const d = JSON.parse(e.data);
          return d.toolName || null;
        } catch {
          return null;
        }
      })(),
    }));

    return {
      jobId: job.id,
      jobStatus: job.status,
      recommendation: job.recommendation,
      confidence: job.confidence,
      linkedinUrl: job.linkedinUrl,
      personName: job.personName,
      stages,
      contactId: contact?.id ?? null,
      contactName: contact?.name ?? null,
      contactTitle: contact?.title ?? null,
      enrichmentId: enrichment?.id ?? null,
      enrichmentStatus: enrichment?.enrichmentStatus ?? null,
      enrichmentBatchId: enrichment?.enrichmentBatchId ?? null,
      enrichCurrentStep: enrichment?.currentStep ?? null,
      enrichErrorMessage: enrichment?.errorMessage ?? null,
      enrichRetryCount: enrichment?.retryCount ?? 0,
      postcardId: postcard?.id ?? null,
      postcardStatus: postcard?.status ?? null,
      postcardBatchId: postcard?.postcardBatchId ?? null,
    };
  });

  return NextResponse.json({
    batch: {
      id: batch.id,
      name: batch.name,
      status: batch.status,
      createdAt: batch.createdAt,
    },
    enrichBatchId: batch.enrichmentBatches[0]?.id ?? null,
    postcardBatchId: batch.postcardBatches[0]?.id ?? null,
    contacts,
  });
}
