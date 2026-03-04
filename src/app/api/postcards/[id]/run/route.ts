import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import { generateNanaBananaWarRoom, generateNanaBananaZoomRoom } from "@/lib/postcard/nano-banana-generator";
import { uploadPostcardImage } from "@/lib/supabase-storage";
import { MAX_POSTCARD_ATTEMPTS } from "@/app/api/postcards/generate-bulk/route";
import { appLog } from "@/lib/app-log";

export const maxDuration = 600;

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

  const teamUserIds = await getTeamUserIds(user);
  const postcard = await prisma.postcard.findFirst({
    where: { id },
    include: { contact: { select: { userId: true } } },
  });

  if (!postcard || !teamUserIds.includes(postcard.contact.userId)) {
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

    appLog("info", "system", "postcard_start", `Postcard ${id} generation attempt ${attempt}/${MAX_POSTCARD_ATTEMPTS}`, { postcardId: id, attempt }).catch(() => {});

    try {
      const existing = await prisma.postcard.findUnique({
        where: { id },
        select: {
          template: true,
          openRoles: true,
          contactName: true,
          companyLogo: true,
          contactPhoto: true,
          teamPhotos: true,
          customPrompt: true,
        },
      });

      // Check for user-uploaded reference images that override defaults
      const refs = await prisma.postcardReference.findMany({
        where: { postcardId: id },
        select: { label: true, imageUrl: true },
      });
      const refByLabel = (label: string) => refs.find((r) => r.label === label)?.imageUrl;

      // Generate the postcard scene — Nano Banana (Gemini) agentic generation
      const teamPhotos = (existing?.teamPhotos as Array<{ photoUrl: string }> | null) ?? [];
      const openRoles = (existing?.openRoles as Array<{ title: string; location: string }> | null) ?? [];

      // Reference images override: prospect_photo, company_logo, team_photo
      const refTeamPhotos = refs.filter((r) => r.label === "team_photo").map((r) => r.imageUrl);

      const nanaBananaInput = {
        prospectPhotoUrl: refByLabel("prospect_photo") ?? existing?.contactPhoto ?? undefined,
        companyLogoUrl: refByLabel("company_logo") ?? existing?.companyLogo ?? null,
        teamPhotoUrls: refTeamPhotos.length > 0
          ? refTeamPhotos
          : teamPhotos.map((p) => p.photoUrl).filter(Boolean),
        openRoles: openRoles.map((r) => ({ title: r.title, location: r.location })),
        prospectName: existing?.contactName ?? undefined,
        customPrompt: existing?.customPrompt ?? undefined,
      };

      let bgBase64: string;
      if (existing?.template === "warroom") {
        bgBase64 = await generateNanaBananaWarRoom(nanaBananaInput);
      } else if (existing?.template === "zoom") {
        bgBase64 = await generateNanaBananaZoomRoom(nanaBananaInput);
      } else {
        throw new Error("Unknown template: " + existing?.template);
      }
      const backgroundUrl = await uploadPostcardImage(
        bgBase64,
        `backgrounds/${id}-${Date.now()}.png`
      );

      // Check cancellation again after the slow image gen step
      const afterBg = await prisma.postcard.findUnique({
        where: { id },
        select: { status: true },
      });
      if (afterBg?.status === "cancelled") {
        await checkAndFinalizeBatch(batchId);
        return NextResponse.json({ status: "cancelled" });
      }

      // The Nano Banana scene IS the final postcard — no separate screenshot step needed
      await prisma.postcard.update({
        where: { id },
        data: { status: "ready", backgroundUrl, imageUrl: backgroundUrl },
      });

      appLog("info", "system", "postcard_complete", `Postcard ${id} generated successfully on attempt ${attempt}`, { postcardId: id, attempt }).catch(() => {});
      succeeded = true;
    } catch (err) {
      lastError = (err as Error).message;
      appLog("error", "system", "postcard_fail", `Postcard ${id} attempt ${attempt} failed: ${lastError}`, { postcardId: id, attempt, error: lastError }).catch(() => {});
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
