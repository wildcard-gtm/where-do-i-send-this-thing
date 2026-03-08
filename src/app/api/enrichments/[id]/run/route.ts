import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runEnrichmentAgent } from "@/agent/enrichment-agent";
import { MAX_ATTEMPTS, STEP_LABELS } from "@/app/api/contacts/enrich-bulk/route";
import { appLog } from "@/lib/app-log";
import { findTeamLinkedInUrls } from "@/lib/enrichment/team-linkedin-finder";

export const maxDuration = 600;

// POST /api/enrichments/[id]/run
// Runs a single CompanyEnrichment record synchronously — called from the browser
// so Vercel keeps the function alive. Returns when the enrichment completes or fails.
// Handles up to MAX_ATTEMPTS retries internally.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  // Load the enrichment record and verify ownership via contact
  const enrichment = await prisma.companyEnrichment.findFirst({
    where: { id },
    include: {
      contact: {
        select: { id: true, name: true, company: true, linkedinUrl: true, title: true, officeAddress: true, csvRowData: true, userId: true },
      },
    },
  });

  if (!enrichment || enrichment.contact.userId !== user.id) {
    return NextResponse.json({ error: "Enrichment not found" }, { status: 404 });
  }

  // Skip if already completed or cancelled
  if (enrichment.enrichmentStatus === "completed" || enrichment.enrichmentStatus === "cancelled") {
    return NextResponse.json({ status: enrichment.enrichmentStatus });
  }

  const contact = enrichment.contact;
  const batchId = enrichment.enrichmentBatchId;

  // Read current attempt count; if already at max, mark failed and return
  let attempt = enrichment.retryCount ?? 0;
  if (attempt >= MAX_ATTEMPTS) {
    await prisma.companyEnrichment.update({
      where: { id },
      data: { enrichmentStatus: "failed", currentStep: null, errorMessage: `Failed after ${MAX_ATTEMPTS} attempts` },
    });
    await checkAndFinalizeBatch(batchId);
    return NextResponse.json({ status: "failed" });
  }

  let succeeded = false;
  let lastError = "";

  while (attempt < MAX_ATTEMPTS) {
    attempt++;

    // Check if cancelled before starting this attempt
    const current = await prisma.companyEnrichment.findUnique({
      where: { id },
      select: { enrichmentStatus: true },
    });
    if (current?.enrichmentStatus === "cancelled") {
      await checkAndFinalizeBatch(batchId);
      return NextResponse.json({ status: "cancelled" });
    }

    await prisma.companyEnrichment.update({
      where: { id },
      data: {
        enrichmentStatus: "enriching",
        currentStep: attempt > 1 ? `Retrying (attempt ${attempt}/${MAX_ATTEMPTS})` : "Starting",
        retryCount: attempt,
        errorMessage: null,
      },
    });

    appLog("info", "system", "enrichment_start", `Enrichment ${id} for ${contact.name} attempt ${attempt}/${MAX_ATTEMPTS}`, { enrichmentId: id, contactId: contact.id, attempt }).catch(() => {});

    try {
      const result = await runEnrichmentAgent(
        {
          contactId: contact.id,
          name: contact.name,
          company: contact.company ?? "Unknown",
          linkedinUrl: contact.linkedinUrl,
          title: contact.title ?? undefined,
          officeAddress: contact.officeAddress ?? undefined,
          csvRowData: contact.csvRowData ?? undefined,
        },
        async (event) => {
          // Check cancellation on each tool call
          const rec = await prisma.companyEnrichment.findUnique({
            where: { id },
            select: { enrichmentStatus: true },
          });
          if (rec?.enrichmentStatus === "cancelled") {
            throw new Error("Enrichment cancelled");
          }

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
              where: { id },
              data: { currentStep: step },
            });
          }
        },
      );

      if (result) {
        // Dedup: remove prospect from teamPhotos to avoid duplicate in postcard
        let cleanedTeamPhotos = result.teamPhotos;
        if (cleanedTeamPhotos && cleanedTeamPhotos.length > 0) {
          const prospectName = (contact.name || "").toLowerCase().trim();
          const prospectNameParts = prospectName.split(/\s+/);
          const prospectFirst = prospectNameParts[0];
          const prospectLast = prospectNameParts[prospectNameParts.length - 1];

          const isDuplicate = (tpName: string) => {
            const n = tpName.toLowerCase().trim();
            if (!n || !prospectName) return false;
            if (n === prospectName) return true;
            if (n.includes(prospectName) || prospectName.includes(n)) return true;
            if (prospectNameParts.length >= 2) {
              const parts = n.split(/\s+/);
              if (parts[0] === prospectFirst && parts[parts.length - 1] === prospectLast) return true;
            }
            return false;
          };

          // Find if any dupe has a photo we should transfer to the prospect
          const currentProfileImage = await prisma.contact.findUnique({
            where: { id: contact.id },
            select: { profileImageUrl: true },
          });
          const hasProfileImage = currentProfileImage?.profileImageUrl &&
            !currentProfileImage.profileImageUrl.includes("default") &&
            !currentProfileImage.profileImageUrl.includes("ghost") &&
            !currentProfileImage.profileImageUrl.includes("static.licdn.com/aero");

          let transferPhotoUrl: string | null = null;
          const dupes = cleanedTeamPhotos.filter(tp => isDuplicate(tp.name ?? ""));
          if (!hasProfileImage && dupes.length > 0) {
            const dupeWithPhoto = dupes.find(d => d.photoUrl && !d.photoUrl.includes("ghost") && !d.photoUrl.includes("default"));
            if (dupeWithPhoto) transferPhotoUrl = dupeWithPhoto.photoUrl;
          }

          cleanedTeamPhotos = cleanedTeamPhotos.filter(tp => !isDuplicate(tp.name ?? ""));

          if (transferPhotoUrl) {
            await prisma.contact.update({
              where: { id: contact.id },
              data: { profileImageUrl: transferPhotoUrl },
            });
          }
        }

        await prisma.companyEnrichment.update({
          where: { id },
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
            teamPhotos: (cleanedTeamPhotos ?? undefined) as any,
            enrichmentStatus: "completed",
            currentStep: null,
            errorMessage: null,
          },
        });
        appLog("info", "system", "enrichment_complete", `Enrichment ${id} completed for ${contact.name}`, { enrichmentId: id, contactId: contact.id, attempt }).catch(() => {});

        // Post-enrichment: find LinkedIn URLs for team members that don't have them
        if (cleanedTeamPhotos && cleanedTeamPhotos.length > 0) {
          const companyName = result.companyName || contact.company || "Unknown";
          findTeamLinkedInUrls(id, cleanedTeamPhotos, companyName).catch(() => {});
        }

        succeeded = true;
      } else {
        lastError = "Agent returned no data";
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "Enrichment cancelled") {
        await prisma.companyEnrichment.update({
          where: { id },
          data: { enrichmentStatus: "cancelled", currentStep: null },
        });
        await checkAndFinalizeBatch(batchId);
        return NextResponse.json({ status: "cancelled" });
      }
      lastError = msg;
      appLog("error", "system", "enrichment_fail", `Enrichment ${id} attempt ${attempt} failed: ${msg}`, { enrichmentId: id, contactId: contact.id, attempt, error: msg }).catch(() => {});
    }

    if (succeeded) break;

    if (attempt < MAX_ATTEMPTS) {
      const delayMs = Math.pow(2, attempt) * 1000;
      await prisma.companyEnrichment.update({
        where: { id },
        data: {
          currentStep: `Retrying in ${delayMs / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS} failed)`,
          errorMessage: lastError,
        },
      });
      await new Promise((r) => setTimeout(r, delayMs));
    } else {
      await prisma.companyEnrichment.update({
        where: { id },
        data: {
          enrichmentStatus: "failed",
          currentStep: null,
          errorMessage: `Failed after ${MAX_ATTEMPTS} attempts: ${lastError}`,
        },
      });
    }
  }

  await checkAndFinalizeBatch(batchId);
  return NextResponse.json({ status: succeeded ? "completed" : "failed" });
}

async function checkAndFinalizeBatch(batchId: string | null) {
  if (!batchId) return;
  // Only finalize if nothing is still actively running or waiting to run
  const remaining = await prisma.companyEnrichment.count({
    where: { enrichmentBatchId: batchId, enrichmentStatus: { in: ["pending", "enriching"] } },
  });
  if (remaining === 0) {
    const failedCount = await prisma.companyEnrichment.count({
      where: { enrichmentBatchId: batchId, enrichmentStatus: "failed" },
    });
    const cancelledCount = await prisma.companyEnrichment.count({
      where: { enrichmentBatchId: batchId, enrichmentStatus: "cancelled" },
    });
    const status = failedCount > 0 ? "failed" : cancelledCount > 0 ? "cancelled" : "complete";
    await prisma.enrichmentBatch.update({
      where: { id: batchId },
      data: { status },
    });
  }
}
