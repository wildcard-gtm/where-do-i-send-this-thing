import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runEnrichmentAgent } from "@/agent/enrichment-agent";

export const maxDuration = 300;

const CONCURRENCY = 3; // Bedrock rate limit is strict — keep this low
export const MAX_ATTEMPTS = 5; // per-contact retry limit before showing manual retry button

// Map tool calls → human-readable step labels (shared with retry route)
export const STEP_LABELS: Record<string, string> = {
  fetch_company_logo: "Fetching company logo",
  search_web: "Searching the web",
  fetch_url: "Reading company page",
  submit_enrichment: "Finalising enrichment",
};

// Run one enrichment record with up to MAX_ATTEMPTS retries (exponential backoff).
// Updates DB on each attempt and on final outcome.
export async function runWithRetry({
  enrichmentRecordId,
  contact,
  batchId,
}: {
  enrichmentRecordId: string;
  contact: {
    id: string;
    name: string;
    company: string | null;
    linkedinUrl: string;
    title: string | null;
    officeAddress: string | null;
  };
  batchId: string;
}): Promise<void> {
  // Read current retry count so we never exceed MAX_ATTEMPTS across route calls
  const record = await prisma.companyEnrichment.findUnique({
    where: { id: enrichmentRecordId },
    select: { retryCount: true },
  });
  let attempt = record?.retryCount ?? 0;

  while (attempt < MAX_ATTEMPTS) {
    attempt++;

    // Mark as enriching + bump retryCount
    await prisma.companyEnrichment.update({
      where: { id: enrichmentRecordId },
      data: {
        enrichmentStatus: "enriching",
        currentStep: attempt > 1 ? `Retrying (attempt ${attempt}/${MAX_ATTEMPTS})` : "Starting",
        retryCount: attempt,
        errorMessage: null,
      },
    });

    let succeeded = false;
    let lastError = "";

    try {
      const result = await runEnrichmentAgent(
        {
          contactId: contact.id,
          name: contact.name,
          company: contact.company ?? "Unknown",
          linkedinUrl: contact.linkedinUrl,
          title: contact.title ?? undefined,
          officeAddress: contact.officeAddress ?? undefined,
        },
        async (event) => {
          if (event.type === "tool_call") {
            const toolName = event.data.tool as string;
            let step = STEP_LABELS[toolName] ?? "Working";
            if (toolName === "search_web" && typeof event.data.input === "object") {
              const query = (event.data.input as { query?: string }).query ?? "";
              if (/role|job|career|hiring/i.test(query)) step = "Searching open roles";
              else if (/value|mission|culture/i.test(query)) step = "Finding company values";
              else if (/office|location|headquarter/i.test(query)) step = "Finding office locations";
              else if (/photo|team|people/i.test(query)) step = "Finding team photos";
              else step = "Searching the web";
            }
            await prisma.companyEnrichment.update({
              where: { id: enrichmentRecordId },
              data: { currentStep: step },
            });
          }
        },
      );

      if (result) {
        await prisma.companyEnrichment.update({
          where: { id: enrichmentRecordId },
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
            currentStep: null,
            errorMessage: null,
          },
        });
        succeeded = true;
      } else {
        lastError = "Agent returned no data";
      }
    } catch (err) {
      lastError = (err as Error).message;
    }

    if (succeeded) break;

    // If we have more attempts left, wait before retrying (exponential backoff: 2s, 4s, 8s, 16s)
    if (attempt < MAX_ATTEMPTS) {
      const delayMs = Math.pow(2, attempt) * 1000;
      await prisma.companyEnrichment.update({
        where: { id: enrichmentRecordId },
        data: {
          enrichmentStatus: "enriching",
          currentStep: `Retrying in ${delayMs / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS} failed)`,
          errorMessage: lastError,
        },
      });
      await new Promise((r) => setTimeout(r, delayMs));
    } else {
      // All attempts exhausted — mark as failed with retry count in message
      await prisma.companyEnrichment.update({
        where: { id: enrichmentRecordId },
        data: {
          enrichmentStatus: "failed",
          currentStep: null,
          errorMessage: `Failed after ${MAX_ATTEMPTS} attempts: ${lastError}`,
        },
      });
    }
  }

  // After this job finishes, check if the whole batch is done
  const remaining = await prisma.companyEnrichment.count({
    where: {
      enrichmentBatchId: batchId,
      enrichmentStatus: { in: ["pending", "enriching"] },
    },
  });
  if (remaining === 0) {
    const failedCount = await prisma.companyEnrichment.count({
      where: { enrichmentBatchId: batchId, enrichmentStatus: "failed" },
    });
    await prisma.enrichmentBatch.update({
      where: { id: batchId },
      data: { status: failedCount > 0 ? "failed" : "complete" },
    });
  }
}

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
        enrichmentStatus: "pending",
        retryCount: 0,
      },
    });

    jobs.push({ contact, enrichmentRecordId: enrichmentRecord.id });
  }

  // Return the batch ID and enrichment record IDs.
  // The browser (enrichment detail page) dispatches individual POST /api/enrichments/[id]/run
  // calls with concurrency control — this keeps Vercel function instances alive per-enrichment.
  return NextResponse.json({
    enrichmentBatchId: enrichmentBatch.id,
    enrichmentIds: jobs.map((j) => j.enrichmentRecordId),
    started: jobs.length,
    skipped: skipped.length,
    skippedIds: skipped,
    message: `Enrichment queued for ${jobs.length} contact(s)`,
  });
}
