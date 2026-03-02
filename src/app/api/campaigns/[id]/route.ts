import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

// PATCH /api/campaigns/[id] — archive or restore
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const { archived } = await request.json();

  const teamUserIds = await getTeamUserIds(user);
  const batch = await prisma.batch.findFirst({ where: { id, userId: { in: teamUserIds } } });
  if (!batch) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  await prisma.batch.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  });

  return NextResponse.json({ success: true });
}

// DELETE /api/campaigns/[id] — hard delete everything
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  const teamUserIds = await getTeamUserIds(user);
  const batch = await prisma.batch.findFirst({
    where: { id, userId: { in: teamUserIds } },
    include: {
      jobs: { select: { id: true, contact: { select: { id: true } } } },
      enrichmentBatches: { select: { id: true } },
      postcardBatches: { select: { id: true } },
    },
  });
  if (!batch) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const jobIds = batch.jobs.map((j) => j.id);
  const contactIds = batch.jobs.flatMap((j) => (j.contact ? [j.contact.id] : []));
  const enrichmentBatchIds = batch.enrichmentBatches.map((e) => e.id);
  const postcardBatchIds = batch.postcardBatches.map((p) => p.id);

  // Delete in dependency order
  await prisma.agentEvent.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.postcard.deleteMany({ where: { postcardBatchId: { in: postcardBatchIds } } });
  await prisma.postcardBatch.deleteMany({ where: { id: { in: postcardBatchIds } } });
  await prisma.companyEnrichment.deleteMany({ where: { enrichmentBatchId: { in: enrichmentBatchIds } } });
  await prisma.enrichmentBatch.deleteMany({ where: { id: { in: enrichmentBatchIds } } });
  await prisma.contactRevision.deleteMany({ where: { contactId: { in: contactIds } } });
  await prisma.chatMessage.deleteMany({ where: { contactId: { in: contactIds } } });
  await prisma.feedback.deleteMany({ where: { contactId: { in: contactIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
  await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.batch.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
