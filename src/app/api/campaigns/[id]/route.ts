import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

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
  const teamUserIds = await getTeamUserIds(user);

  const batch = await prisma.batch.findFirst({
    where: { id, userId: { in: teamUserIds } },
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
              company: true,
              title: true,
              profileImageUrl: true,
              officeAddress: true,
              companyEnrichments: {
                where: { isLatest: true },
                take: 1,
                select: {
                  id: true,
                  enrichmentBatchId: true,
                  enrichmentStatus: true,
                  currentStep: true,
                  errorMessage: true,
                  retryCount: true,
                  updatedAt: true,
                },
              },
              postcards: {
                where: { status: { notIn: ["cancelled", "failed"] } },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  postcardBatchId: true,
                  status: true,
                  template: true,
                  updatedAt: true,
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
    const enrichment = contact?.companyEnrichments[0] ?? null;
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

    // Compute isRemote: use postcard template if available, otherwise derive
    // from job flags + recommendation (same logic as postcard generation)
    let isRemote: boolean | null = null;
    if (postcard?.template) {
      isRemote = postcard.template === "zoom";
    } else if (job.status === "complete") {
      try {
        const jobResult = job.result ? JSON.parse(job.result) : null;
        const flags: string[] = jobResult?.decision?.flags ?? [];
        isRemote =
          flags.some((f: string) =>
            f.toLowerCase().includes("fully_remote") ||
            f.toLowerCase().includes("no_local_office")
          ) ||
          (job.recommendation === "HOME" && !contact?.officeAddress);
      } catch {
        isRemote = null;
      }
    }

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
      contactCompany: contact?.company ?? null,
      contactTitle: contact?.title ?? null,
      profileImageUrl: contact?.profileImageUrl ?? null,
      enrichmentId: enrichment?.id ?? null,
      enrichmentStatus: enrichment?.enrichmentStatus ?? null,
      enrichmentBatchId: enrichment?.enrichmentBatchId ?? null,
      enrichCurrentStep: enrichment?.currentStep ?? null,
      enrichErrorMessage: enrichment?.errorMessage ?? null,
      enrichRetryCount: enrichment?.retryCount ?? 0,
      enrichUpdatedAt: enrichment?.updatedAt ?? null,
      postcardId: postcard?.id ?? null,
      postcardStatus: postcard?.status ?? null,
      postcardBatchId: postcard?.postcardBatchId ?? null,
      postcardTemplate: postcard?.template ?? null,
      postcardUpdatedAt: postcard?.updatedAt ?? null,
      jobUpdatedAt: job.updatedAt ?? null,
      isRemote,
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

// PATCH /api/campaigns/[id] — archive or restore
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const { archived } = await request.json();

  const teamUserIds = await getTeamUserIds(user);
  const batch = await prisma.batch.findFirst({ where: { id, userId: { in: teamUserIds } } });
  if (!batch) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  await prisma.batch.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  });

  return NextResponse.json({ success: true });
}

// DELETE /api/campaigns/[id] — hard delete everything
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  const teamUserIds = await getTeamUserIds(user);
  const batch = await prisma.batch.findFirst({
    where: { id, userId: { in: teamUserIds } },
    include: {
      jobs: { select: { id: true, contact: { select: { id: true } } } },
      enrichmentBatches: { select: { id: true } },
      postcardBatches: { select: { id: true } },
    },
  });
  if (!batch) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const jobIds = batch.jobs.map((j) => j.id);
  const contactIds = batch.jobs.flatMap((j) => (j.contact ? [j.contact.id] : []));
  const enrichmentBatchIds = batch.enrichmentBatches.map((e) => e.id);
  const postcardBatchIds = batch.postcardBatches.map((p) => p.id);

  // Delete in dependency order
  await prisma.agentEvent.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.postcard.deleteMany({ where: { postcardBatchId: { in: postcardBatchIds } } });
  await prisma.postcardBatch.deleteMany({ where: { id: { in: postcardBatchIds } } });
  await prisma.companyEnrichment.deleteMany({ where: { enrichmentBatchId: { in: enrichmentBatchIds } } });
  await prisma.enrichmentBatch.deleteMany({ where: { id: { in: enrichmentBatchIds } } });
  await prisma.contactRevision.deleteMany({ where: { contactId: { in: contactIds } } });
  await prisma.chatMessage.deleteMany({ where: { contactId: { in: contactIds } } });
  await prisma.feedback.deleteMany({ where: { contactId: { in: contactIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
  await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.batch.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
