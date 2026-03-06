import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import { isPlaceholderUrl } from "@/lib/photo-finder/detect-placeholder";

export const maxDuration = 300;

// POST /api/postcards/generate
// Creates a single Postcard record (status: "pending") and returns its ID.
// The caller is responsible for then calling POST /api/postcards/[id]/run
// to actually generate the postcard (keeps Vercel function alive via browser dispatch).
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const {
    contactId,
    template: requestedTemplate,
    customPrompt,
    contactPhoto: overrideContactPhoto,
    teamPhotos: overrideTeamPhotos,
    companyLogo: overrideCompanyLogo,
    openRoles: overrideOpenRoles,
    parentPostcardId,
  } = await request.json();

  if (!contactId) {
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }

  // Verify contact belongs to user
  const teamUserIds = await getTeamUserIds(user);
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: { in: teamUserIds } },
    include: {
      job: { select: { result: true } },
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  // Load latest completed company enrichment
  const enrichment = await prisma.companyEnrichment.findFirst({
    where: { contactId, isLatest: true, enrichmentStatus: "completed" },
  });

  // Auto-select template if not specified
  let template = requestedTemplate as "warroom" | "zoom" | undefined;
  if (!template) {
    const jobResult = contact.job?.result ? JSON.parse(contact.job.result) : null;
    const flags: string[] = jobResult?.decision?.flags ?? [];
    const isFullyRemote =
      flags.some((f: string) =>
        f.toLowerCase().includes("fully_remote") ||
        f.toLowerCase().includes("no_local_office")
      ) ||
      (contact.recommendation === "HOME" && !contact.officeAddress);
    template = isFullyRemote ? "zoom" : "warroom";
  }

  // Determine delivery address from recommendation
  const deliveryAddress =
    contact.recommendation === "HOME"
      ? contact.homeAddress
      : contact.recommendation === "OFFICE"
      ? contact.officeAddress
      : contact.homeAddress || contact.officeAddress;

  // Resolve contact photo: prefer non-placeholder from override, then contact DB, then enrichment
  const resolvedContactPhoto =
    (overrideContactPhoto && !isPlaceholderUrl(overrideContactPhoto))
      ? overrideContactPhoto
      : (!isPlaceholderUrl(contact.profileImageUrl) ? contact.profileImageUrl : overrideContactPhoto ?? contact.profileImageUrl);

  // Resolve team photos: merge overrides with enrichment, replacing placeholders
  const enrichTeam = (enrichment?.teamPhotos as Array<{ name?: string; photoUrl: string; title?: string; linkedinUrl?: string }>) ?? [];
  let resolvedTeamPhotos: typeof enrichTeam | undefined;
  if (overrideTeamPhotos && Array.isArray(overrideTeamPhotos) && overrideTeamPhotos.length > 0) {
    resolvedTeamPhotos = overrideTeamPhotos.map((ot: { name?: string; photoUrl: string; title?: string; linkedinUrl?: string }, i: number) => {
      const et = enrichTeam[i];
      // If override has placeholder, substitute with enrichment photo
      if (isPlaceholderUrl(ot.photoUrl) && et && !isPlaceholderUrl(et.photoUrl)) {
        return { ...ot, photoUrl: et.photoUrl };
      }
      return ot;
    });
  } else if (enrichTeam.length > 0) {
    resolvedTeamPhotos = enrichTeam;
  }

  // Create Postcard record — caller dispatches /run to generate
  const postcard = await prisma.postcard.create({
    data: {
      contactId,
      template,
      status: "pending",
      retryCount: 0,
      contactName: contact.name,
      contactTitle: contact.title,
      contactPhoto: resolvedContactPhoto,
      deliveryAddress,
      companyLogo: (overrideCompanyLogo && overrideCompanyLogo !== enrichment?.companyLogo)
        ? overrideCompanyLogo   // User explicitly changed the logo (upload/paste)
        : enrichment?.companyLogo ?? null,  // Always prefer latest enrichment
      openRoles: overrideOpenRoles ?? enrichment?.openRoles ?? undefined,
      companyValues: enrichment?.companyValues ?? undefined,
      companyMission: enrichment?.companyMission ?? null,
      officeLocations: enrichment?.officeLocations ?? undefined,
      teamPhotos: resolvedTeamPhotos ?? undefined,
      customPrompt: customPrompt ?? null,
      parentPostcardId: parentPostcardId ?? null,
    },
  });

  return NextResponse.json({
    postcardId: postcard.id,
    template,
    status: "pending",
  });
}
