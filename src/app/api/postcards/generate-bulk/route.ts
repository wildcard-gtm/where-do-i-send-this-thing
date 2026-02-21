import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getWarRoomPrompt, getZoomRoomPrompt } from "@/lib/postcard/prompt-generator";
import { generateBackground } from "@/lib/postcard/background-generator";
import { screenshotPostcard } from "@/lib/postcard/screenshot";

export const maxDuration = 300;

export const MAX_POSTCARD_ATTEMPTS = 5;

// Run one postcard generation with up to MAX_POSTCARD_ATTEMPTS retries (exponential backoff).
export async function generatePostcardWithRetry(postcardId: string): Promise<void> {
  const record = await prisma.postcard.findUnique({
    where: { id: postcardId },
    select: { retryCount: true, backgroundPrompt: true, template: true },
  });
  if (!record) return;

  let attempt = record.retryCount ?? 0;

  while (attempt < MAX_POSTCARD_ATTEMPTS) {
    attempt++;

    await prisma.postcard.update({
      where: { id: postcardId },
      data: {
        status: "generating",
        retryCount: attempt,
        errorMessage: null,
      },
    });

    let succeeded = false;
    let lastError = "";

    try {
      // Reuse existing backgroundPrompt on retries to avoid re-billing image generation
      const prompt =
        record.backgroundPrompt ??
        (record.template === "zoom" ? getZoomRoomPrompt() : getWarRoomPrompt());

      const bgBase64 = await generateBackground(prompt);
      const backgroundUrl = `data:image/png;base64,${bgBase64}`;

      await prisma.postcard.update({
        where: { id: postcardId },
        data: { status: "generating", backgroundUrl, backgroundPrompt: prompt },
      });

      const imageBase64 = await screenshotPostcard(postcardId);
      const imageUrl = `data:image/png;base64,${imageBase64}`;

      await prisma.postcard.update({
        where: { id: postcardId },
        data: { status: "ready", imageUrl },
      });

      succeeded = true;
    } catch (err) {
      lastError = (err as Error).message;
    }

    if (succeeded) break;

    if (attempt < MAX_POSTCARD_ATTEMPTS) {
      const delayMs = Math.pow(2, attempt) * 1000;
      await prisma.postcard.update({
        where: { id: postcardId },
        data: {
          status: "generating",
          errorMessage: `Attempt ${attempt} failed, retrying in ${delayMs / 1000}s: ${lastError}`,
        },
      });
      await new Promise((r) => setTimeout(r, delayMs));
    } else {
      await prisma.postcard.update({
        where: { id: postcardId },
        data: {
          status: "failed",
          errorMessage: `Failed after ${MAX_POSTCARD_ATTEMPTS} attempts: ${lastError}`,
        },
      });
    }
  }
}

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

    started.push(postcard.id);

    // Fire-and-forget with auto-retry
    generatePostcardWithRetry(postcard.id);
  }

  return NextResponse.json({
    started: started.length,
    postcardIds: started,
    message: `Postcard generation started for ${started.length} contact(s)`,
  });
}
