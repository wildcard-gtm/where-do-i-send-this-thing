import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTeamUserIds } from "@/lib/team";
import { prisma } from "@/lib/db";
import { deletePostcardImage } from "@/lib/supabase-storage";

// GET — count old revisions that would be deleted
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const teamUserIds = await getTeamUserIds(user);

  // Get all non-failed/cancelled postcards for this team, newest first
  const postcards = await prisma.postcard.findMany({
    where: { contact: { userId: { in: teamUserIds } } },
    orderBy: { createdAt: "desc" },
    select: { id: true, contactId: true, status: true, imageUrl: true, createdAt: true },
  });

  // Find which ones are "old" (not the latest per contact)
  const seen = new Set<string>();
  let oldCount = 0;
  let storageBytes = 0;
  const latestIds: string[] = [];

  for (const p of postcards) {
    // Keep the first non-failed/non-cancelled per contact as "latest"
    if (!seen.has(p.contactId) && p.status !== "failed" && p.status !== "cancelled") {
      seen.add(p.contactId);
      latestIds.push(p.id);
    } else {
      oldCount++;
    }
  }

  return NextResponse.json({
    totalPostcards: postcards.length,
    latestCount: latestIds.length,
    oldRevisions: oldCount,
  });
}

// DELETE — delete all old revisions, keep only the latest per contact
export async function DELETE() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const teamUserIds = await getTeamUserIds(user);

  const postcards = await prisma.postcard.findMany({
    where: { contact: { userId: { in: teamUserIds } } },
    orderBy: { createdAt: "desc" },
    select: { id: true, contactId: true, status: true, imageUrl: true },
  });

  // Identify latest per contact
  const seen = new Set<string>();
  const toDelete: { id: string; imageUrl: string | null }[] = [];

  for (const p of postcards) {
    if (!seen.has(p.contactId) && p.status !== "failed" && p.status !== "cancelled") {
      seen.add(p.contactId);
      // Keep this one
    } else {
      toDelete.push({ id: p.id, imageUrl: p.imageUrl });
    }
  }

  if (toDelete.length === 0) {
    return NextResponse.json({ deleted: 0, message: "No old revisions to delete" });
  }

  // Clear parentPostcardId references so we can delete without FK issues
  const deleteIds = toDelete.map((p) => p.id);
  await prisma.postcard.updateMany({
    where: { parentPostcardId: { in: deleteIds } },
    data: { parentPostcardId: null },
  });

  // Delete from Supabase storage in batches of 10
  for (let i = 0; i < toDelete.length; i += 10) {
    const batch = toDelete.slice(i, i + 10);
    await Promise.all(
      batch.flatMap((p) => [
        deletePostcardImage(`backgrounds/${p.id}.png`),
        deletePostcardImage(`finals/${p.id}.png`),
        // Also try timestamp-based paths by extracting from imageUrl
        ...(p.imageUrl ? [deleteStorageFromUrl(p.imageUrl)] : []),
      ])
    );
  }

  // Delete DB records in batches
  await prisma.postcard.deleteMany({
    where: { id: { in: deleteIds } },
  });

  return NextResponse.json({
    deleted: toDelete.length,
    message: `Deleted ${toDelete.length} old revision(s)`,
  });
}

async function deleteStorageFromUrl(url: string): Promise<void> {
  // Extract path from URL like ".../storage/v1/object/public/postcards/backgrounds/abc-123.png?v=..."
  const marker = "/storage/v1/object/public/postcards/";
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = url.slice(idx + marker.length).split("?")[0];
  if (path) await deletePostcardImage(path);
}
