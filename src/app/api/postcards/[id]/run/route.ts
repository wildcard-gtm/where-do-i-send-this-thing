import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getWarRoomPrompt, getZoomRoomPrompt } from "@/lib/postcard/prompt-generator";
import { generateBackground } from "@/lib/postcard/background-generator";
import { screenshotPostcard } from "@/lib/postcard/screenshot";
import { generatePostcardCopy } from "@/lib/postcard/copy-generator";
import { extractAccentColor } from "@/lib/postcard/color-extractor";
import { MAX_POSTCARD_ATTEMPTS } from "@/app/api/postcards/generate-bulk/route";

export const maxDuration = 300;

// POST /api/postcards/[id]/run
// Runs a single Postcard generation synchronously — called from the browser
// so Vercel keeps the function alive. Returns when generation completes or fails.
// Handles up to MAX_POSTCARD_ATTEMPTS retries internally.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const postcard = await prisma.postcard.findFirst({
    where: { id },
    include: { contact: { select: { userId: true } } },
  });

  if (!postcard || postcard.contact.userId !== user.id) {
    return NextResponse.json({ error: "Postcard not found" }, { status: 404 });
  }

  // Skip if already done or cancelled
  if (postcard.status === "ready" || postcard.status === "approved" || postcard.status === "cancelled") {
    return NextResponse.json({ status: postcard.status });
  }

  const batchId = postcard.postcardBatchId;

  let attempt = postcard.retryCount ?? 0;
  if (attempt >= MAX_POSTCARD_ATTEMPTS) {
    await prisma.postcard.update({
      where: { id },
      data: { status: "failed", errorMessage: `Failed after ${MAX_POSTCARD_ATTEMPTS} attempts` },
    });
    await checkAndFinalizeBatch(batchId);
    return NextResponse.json({ status: "failed" });
  }

  let succeeded = false;
  let lastError = "";

  while (attempt < MAX_POSTCARD_ATTEMPTS) {
    attempt++;

    // Check cancellation before starting attempt
    const current = await prisma.postcard.findUnique({
      where: { id },
      select: { status: true },
    });
    if (current?.status === "cancelled") {
      await checkAndFinalizeBatch(batchId);
      return NextResponse.json({ status: "cancelled" });
    }

    await prisma.postcard.update({
      where: { id },
      data: {
        status: "generating",
        retryCount: attempt,
        errorMessage: null,
      },
    });

    try {
      // Reuse existing backgroundPrompt/copy on retries to avoid re-billing
      const existing = await prisma.postcard.findUnique({
        where: { id },
        select: {
          backgroundPrompt: true,
          template: true,
          postcardHeadline: true,
          postcardDescription: true,
          companyMission: true,
          companyValues: true,
          openRoles: true,
          officeLocations: true,
          contactName: true,
          companyLogo: true,
        },
      });

      // Generate copy from enrichment data on first attempt only
      let headline = existing?.postcardHeadline ?? null;
      let description = existing?.postcardDescription ?? null;
      let imagePrompt = existing?.backgroundPrompt ?? null;
      let accentColor = (existing as Record<string, unknown>)?.accentColor as string | null ?? null;

      if (!headline || !description || !imagePrompt) {
        // Extract company name from logo URL hostname or fall back to contact name
        const companyName = (() => {
          try {
            if (existing?.companyLogo) {
              const host = new URL(existing.companyLogo).hostname.replace(/^www\./, "");
              return host.split(".")[0];
            }
          } catch { /* ignore */ }
          return existing?.contactName ?? "the company";
        })();

        // Run copy generation and color extraction in parallel
        const [copy, extractedColor] = await Promise.all([
          generatePostcardCopy({
            companyName,
            companyMission: existing?.companyMission,
            companyValues: existing?.companyValues as string[] | null,
            openRoles: existing?.openRoles as Array<{ title: string; location: string; level: string }> | null,
            officeLocations: existing?.officeLocations as string[] | null,
          }),
          extractAccentColor(existing?.companyLogo),
        ]);

        headline = copy.headline;
        description = copy.description;
        imagePrompt = copy.imagePrompt;
        accentColor = extractedColor;

        // Persist so retries don't regenerate
        await prisma.postcard.update({
          where: { id },
          data: {
            postcardHeadline: headline,
            postcardDescription: description,
            backgroundPrompt: imagePrompt,
            accentColor,
          },
        });
      }

      // Fall back to static prompts if copy generation produced nothing
      const prompt =
        imagePrompt ??
        (existing?.template === "zoom" ? getZoomRoomPrompt() : getWarRoomPrompt());

      const bgBase64 = await generateBackground(prompt);
      const backgroundUrl = `data:image/png;base64,${bgBase64}`;

      // Check cancellation again after the slow image gen step
      const afterBg = await prisma.postcard.findUnique({
        where: { id },
        select: { status: true },
      });
      if (afterBg?.status === "cancelled") {
        await checkAndFinalizeBatch(batchId);
        return NextResponse.json({ status: "cancelled" });
      }

      await prisma.postcard.update({
        where: { id },
        data: { status: "generating", backgroundUrl, backgroundPrompt: prompt },
      });

      const imageBase64 = await screenshotPostcard(id);
      const imageUrl = `data:image/png;base64,${imageBase64}`;

      await prisma.postcard.update({
        where: { id },
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
        where: { id },
        data: {
          status: "generating",
          errorMessage: `Attempt ${attempt} failed, retrying in ${delayMs / 1000}s: ${lastError}`,
        },
      });
      await new Promise((r) => setTimeout(r, delayMs));
    } else {
      await prisma.postcard.update({
        where: { id },
        data: {
          status: "failed",
          errorMessage: `Failed after ${MAX_POSTCARD_ATTEMPTS} attempts: ${lastError}`,
        },
      });
    }
  }

  await checkAndFinalizeBatch(batchId);
  return NextResponse.json({ status: succeeded ? "ready" : "failed" });
}

async function checkAndFinalizeBatch(batchId: string | null | undefined) {
  if (!batchId) return;
  const remaining = await prisma.postcard.count({
    where: { postcardBatchId: batchId, status: { in: ["pending", "generating"] } },
  });
  if (remaining === 0) {
    const failedCount = await prisma.postcard.count({
      where: { postcardBatchId: batchId, status: "failed" },
    });
    const cancelledCount = await prisma.postcard.count({
      where: { postcardBatchId: batchId, status: "cancelled" },
    });
    const status = failedCount > 0 ? "failed" : cancelledCount > 0 ? "cancelled" : "complete";
    await prisma.postcardBatch.update({
      where: { id: batchId },
      data: { status },
    });
  }
}
