import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

export const maxDuration = 300;

export const MAX_POSTCARD_ATTEMPTS = 7;

// POST /api/postcards/generate-bulk
// Body: { contactIds: string[], scanBatchId?: string, backMessage?: string }
// Creates a PostcardBatch + individual Postcard records (status: "pending").
// Returns the batch ID so the browser can redirect to the batch detail page,
// which dispatches individual POST /api/postcards/[id]/run calls with concurrency control.
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const {
    contactIds,
    scanBatchId,
    backMessage,
  } = await request.json();

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return NextResponse.json({ error: "contactIds array required" }, { status: 400 });
  }

  const teamUserIds = await getTeamUserIds(user);
  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, userId: { in: teamUserIds } },
    include: { job: { select: { result: true } } },
  });

  if (contacts.length === 0) {
    return NextResponse.json({ error: "No valid contacts found" }, { status: 400 });
  }

  // Create a PostcardBatch to group this run
  const batchName = `Postcards · ${new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;

  const postcardBatch = await prisma.postcardBatch.create({
    data: {
      userId: user.id,
      teamId: user.teamId ?? null,
      name: batchName,
      status: "running",
      ...(scanBatchId ? { scanBatchId } : {}),
      ...(backMessage ? { backMessage } : {}),
    },
  });

  const postcardIds: string[] = [];

  for (const contact of contacts) {
    // Load latest enrichment
    const enrichment = await prisma.companyEnrichment.findFirst({
      where: { contactId: contact.id, isLatest: true, enrichmentStatus: "completed" },
    });

    // Load latest existing postcard — may contain user edits from the regenerate modal
    // that should be preserved across force-regenerations
    const latestPostcard = await prisma.postcard.findFirst({
      where: { contactId: contact.id, status: { notIn: ["failed", "cancelled"] } },
      orderBy: { createdAt: "desc" },
    });

    // Auto-select template (prefer latest postcard's template if user changed it)
    const jobResult = contact.job?.result ? JSON.parse(contact.job.result) : null;
    const flags: string[] = jobResult?.decision?.flags ?? [];
    const isFullyRemote =
      flags.some((f: string) =>
        f.toLowerCase().includes("fully_remote") || f.toLowerCase().includes("no_local_office")
      ) ||
      (contact.recommendation === "HOME" && !contact.officeAddress);
    const autoTemplate: "warroom" | "zoom" = isFullyRemote ? "zoom" : "warroom";
    const template = (latestPostcard?.template as "warroom" | "zoom") ?? autoTemplate;

    const deliveryAddress =
      contact.recommendation === "HOME"
        ? contact.homeAddress
        : contact.recommendation === "OFFICE"
        ? contact.officeAddress
        : contact.homeAddress || contact.officeAddress;

    // Prefer latest postcard values (which include user edits from the modal)
    // over raw enrichment data. If no postcard exists yet, fall back to enrichment.
    const postcard = await prisma.postcard.create({
      data: {
        contactId: contact.id,
        postcardBatchId: postcardBatch.id,
        template,
        status: "pending",
        retryCount: 0,
        contactName: contact.name,
        contactTitle: contact.title,
        contactPhoto: latestPostcard?.contactPhoto ?? contact.profileImageUrl,
        deliveryAddress,
        companyLogo: latestPostcard?.companyLogo ?? enrichment?.companyLogo ?? null,
        openRoles: (latestPostcard?.openRoles ?? enrichment?.openRoles ?? undefined) as string[] | undefined,
        companyValues: (latestPostcard?.companyValues ?? enrichment?.companyValues ?? undefined) as string[] | undefined,
        companyMission: latestPostcard?.companyMission ?? enrichment?.companyMission ?? null,
        officeLocations: (latestPostcard?.officeLocations ?? enrichment?.officeLocations ?? undefined) as string[] | undefined,
        teamPhotos: latestPostcard?.teamPhotos ?? enrichment?.teamPhotos ?? undefined,
        customPrompt: latestPostcard?.customPrompt ?? null,
        ...(backMessage ? { backMessage } : {}),
      },
    });

    postcardIds.push(postcard.id);
  }

  // Return the batch ID. The browser (postcard batch detail page) dispatches
  // individual POST /api/postcards/[id]/run calls with concurrency control —
  // this keeps Vercel function instances alive per-postcard.
  return NextResponse.json({
    postcardBatchId: postcardBatch.id,
    postcardIds,
    started: postcardIds.length,
    message: `Postcard generation queued for ${postcardIds.length} contact(s)`,
  });
}
