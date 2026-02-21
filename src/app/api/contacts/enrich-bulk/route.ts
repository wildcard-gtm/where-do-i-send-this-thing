import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runEnrichmentAgent } from "@/agent/enrichment-agent";

export const maxDuration = 300;

const CONCURRENCY = 3; // Bedrock rate limit is strict — keep this low

// POST /api/contacts/enrich-bulk
// Body: { contactIds: string[] }
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { contactIds } = await request.json();

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return NextResponse.json({ error: "contactIds array required" }, { status: 400 });
  }

  // Verify all contacts belong to this user
  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, userId: user.id },
    select: { id: true, name: true, company: true, linkedinUrl: true, title: true, officeAddress: true },
  });

  const valid = contacts;
  const skipped = contactIds.filter((id) => !valid.find((c) => c.id === id));

  if (valid.length === 0) {
    return NextResponse.json({ error: "No valid contacts found" }, { status: 400 });
  }

  // Create an EnrichmentBatch to group this run
  const batchName = `Enrichment · ${new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;

  const enrichmentBatch = await prisma.enrichmentBatch.create({
    data: { userId: user.id, name: batchName, status: "running" },
  });

  // Create all DB records upfront so the UI can show them immediately
  type EnrichmentJob = {
    contact: typeof valid[number];
    enrichmentRecordId: string;
  };

  const jobs: EnrichmentJob[] = [];

  for (const contact of valid) {
    await prisma.companyEnrichment.updateMany({
      where: { contactId: contact.id, isLatest: true },
      data: { isLatest: false },
    });

    const latestRevision = await prisma.companyEnrichment.findFirst({
      where: { contactId: contact.id },
      orderBy: { revisionNumber: "desc" },
      select: { revisionNumber: true },
    });
    const nextRevision = (latestRevision?.revisionNumber ?? 0) + 1;

    const enrichmentRecord = await prisma.companyEnrichment.create({
      data: {
        contactId: contact.id,
        enrichmentBatchId: enrichmentBatch.id,
        revisionNumber: nextRevision,
        isLatest: true,
        companyName: contact.company ?? "Unknown",
        enrichmentStatus: "enriching",
      },
    });

    jobs.push({ contact, enrichmentRecordId: enrichmentRecord.id });
  }

  // Run agents with concurrency limit in the background — do NOT await
  (async () => {
    let idx = 0;

    const runNext = async (): Promise<void> => {
      while (idx < jobs.length) {
        const job = jobs[idx++];

        try {
          const result = await runEnrichmentAgent(
            {
              contactId: job.contact.id,
              name: job.contact.name,
              company: job.contact.company ?? "Unknown",
              linkedinUrl: job.contact.linkedinUrl,
              title: job.contact.title ?? undefined,
              officeAddress: job.contact.officeAddress ?? undefined,
            },
            () => {},
          );

          if (result) {
            await prisma.companyEnrichment.update({
              where: { id: job.enrichmentRecordId },
              data: {
                companyName: result.companyName,
                companyWebsite: result.companyWebsite ?? null,
                companyLogo: result.companyLogo ?? null,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                openRoles: (result.openRoles ?? undefined) as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                companyValues: (result.companyValues ?? undefined) as any,
                companyMission: result.companyMission ?? null,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                officeLocations: (result.officeLocations ?? undefined) as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                teamPhotos: (result.teamPhotos ?? undefined) as any,
                enrichmentStatus: "completed",
                errorMessage: null,
              },
            });
          } else {
            await prisma.companyEnrichment.update({
              where: { id: job.enrichmentRecordId },
              data: { enrichmentStatus: "failed", errorMessage: "Agent returned no data" },
            });
          }
        } catch (err) {
          await prisma.companyEnrichment.update({
            where: { id: job.enrichmentRecordId },
            data: { enrichmentStatus: "failed", errorMessage: (err as Error).message },
          });
        }

        // After each job, check if the whole batch is done
        const remaining = await prisma.companyEnrichment.count({
          where: {
            enrichmentBatchId: enrichmentBatch.id,
            enrichmentStatus: { in: ["pending", "enriching"] },
          },
        });
        if (remaining === 0) {
          const failedCount = await prisma.companyEnrichment.count({
            where: { enrichmentBatchId: enrichmentBatch.id, enrichmentStatus: "failed" },
          });
          await prisma.enrichmentBatch.update({
            where: { id: enrichmentBatch.id },
            data: { status: failedCount > 0 ? "failed" : "complete" },
          });
        }
      }
    };

    // Start CONCURRENCY workers that pull from the shared idx
    const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => runNext());
    await Promise.allSettled(workers);
  })();

  return NextResponse.json({
    enrichmentBatchId: enrichmentBatch.id,
    started: jobs.length,
    skipped: skipped.length,
    skippedIds: skipped,
    message: `Enrichment started for ${jobs.length} contact(s)`,
  });
}
