import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getWarRoomPrompt, getZoomRoomPrompt } from "@/lib/postcard/prompt-generator";
import { generateBackground } from "@/lib/postcard/background-generator";
import { screenshotPostcard } from "@/lib/postcard/screenshot";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { contactId, template: requestedTemplate } = await request.json();

  if (!contactId) {
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }

  // Verify contact belongs to user
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: user.id },
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

  // Create Postcard record
  const postcard = await prisma.postcard.create({
    data: {
      contactId,
      template,
      status: "pending",
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

  const prompt = template === "zoom" ? getZoomRoomPrompt() : getWarRoomPrompt();

  // Fire-and-forget generation pipeline
  (async () => {
    try {
      // Step 1: Generate background — returns base64 PNG
      const bgBase64 = await generateBackground(prompt);
      const backgroundUrl = `data:image/png;base64,${bgBase64}`;

      await prisma.postcard.update({
        where: { id: postcard.id },
        data: {
          status: "generating",
          backgroundUrl,
          backgroundPrompt: prompt,
        },
      });

      // Step 2: Render the composited postcard via next/og image route
      const imageBase64 = await screenshotPostcard(postcard.id);
      const imageUrl = `data:image/png;base64,${imageBase64}`;

      await prisma.postcard.update({
        where: { id: postcard.id },
        data: {
          status: "ready",
          imageUrl,
        },
      });
    } catch (err) {
      await prisma.postcard.update({
        where: { id: postcard.id },
        data: {
          status: "failed",
          errorMessage: (err as Error).message,
        },
      });
    }
  })();

  return NextResponse.json({
    postcardId: postcard.id,
    template,
    status: "pending",
  });
}
