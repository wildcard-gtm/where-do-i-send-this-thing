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

  const { contactIds } = await request.json();

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return NextResponse.json({ error: "contactIds array required" }, { status: 400 });
  }

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, userId: user.id },
    include: { job: { select: { result: true } } },
  });

  const started: string[] = [];

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

    started.push(postcard.id);

    const prompt = template === "zoom" ? getZoomRoomPrompt() : getWarRoomPrompt();

    // Fire-and-forget per contact
    (async (pid: string) => {
      try {
        // Step 1: Generate background — returns base64 PNG
        const bgBase64 = await generateBackground(prompt);
        const backgroundUrl = `data:image/png;base64,${bgBase64}`;

        await prisma.postcard.update({
          where: { id: pid },
          data: {
            status: "generating",
            backgroundUrl,
            backgroundPrompt: prompt,
          },
        });

        // Step 2: Render composited postcard via next/og image route
        const imageBase64 = await screenshotPostcard(pid);
        const imageUrl = `data:image/png;base64,${imageBase64}`;

        await prisma.postcard.update({
          where: { id: pid },
          data: { status: "ready", imageUrl },
        });
      } catch (err) {
        await prisma.postcard.update({
          where: { id: pid },
          data: { status: "failed", errorMessage: (err as Error).message },
        });
      }
    })(postcard.id);
  }

  return NextResponse.json({
    started: started.length,
    postcardIds: started,
    message: `Postcard generation started for ${started.length} contact(s)`,
  });
}
