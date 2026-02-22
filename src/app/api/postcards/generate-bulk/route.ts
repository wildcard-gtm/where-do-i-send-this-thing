import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const maxDuration = 300;

export const MAX_POSTCARD_ATTEMPTS = 5;

// POST /api/postcards/generate-bulk
// Body: { contactIds: string[] }
// Creates a PostcardBatch + individual Postcard records (status: "pending").
// Returns the batch ID so the browser can redirect to the batch detail page,
// which dispatches individual POST /api/postcards/[id]/run calls with concurrency control.
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { contactIds } = await request.json();

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return NextResponse.json({ error: "contactIds array required" }, { status: 400 });
  }

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, userId: user.id },
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
    data: { userId: user.id, name: batchName, status: "running" },
  });

  const postcardIds: string[] = [];

  for (const contact of contacts) {
    // Load latest enrichment
    const enrichment = await prisma.companyEnrichment.findFirst({
      where: { contactId: contact.id, isLatest: true, enrichmentStatus: "completed" },
    });

    // Auto-select template
    const jobResult = contact.job?.result ? JSON.parse(contact.job.result) : null;
    const flags: string[] = jobResult?.decision?.flags ?? [];
    const isFullyRemote =
      flags.some((f: string) =>
        f.toLowerCase().includes("fully_remote") || f.toLowerCase().includes("no_local_office")
      ) ||
      (contact.recommendation === "HOME" && !contact.officeAddress);
    const template: "warroom" | "zoom" = isFullyRemote ? "zoom" : "warroom";

    const deliveryAddress =
      contact.recommendation === "HOME"
        ? contact.homeAddress
        : contact.recommendation === "OFFICE"
        ? contact.officeAddress
        : contact.homeAddress || contact.officeAddress;

    const postcard = await prisma.postcard.create({
      data: {
        contactId: contact.id,
        postcardBatchId: postcardBatch.id,
        template,
        status: "pending",
        retryCount: 0,
        contactName: contact.name,
        contactTitle: contact.title,
        contactPhoto: contact.profileImageUrl,
        deliveryAddress,
        companyLogo: enrichment?.companyLogo ?? null,
        openRoles: enrichment?.openRoles ?? undefined,
        companyValues: enrichment?.companyValues ?? undefined,
        companyMission: enrichment?.companyMission ?? null,
        officeLocations: enrichment?.officeLocations ?? undefined,
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
