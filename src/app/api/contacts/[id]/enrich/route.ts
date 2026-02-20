import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runEnrichmentAgent } from "@/agent/enrichment-agent";

export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, userId: user.id },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  if (!contact.company) {
    return NextResponse.json({ error: "Contact has no company — cannot enrich" }, { status: 400 });
  }

  // Mark any existing enrichments as not latest
  await prisma.companyEnrichment.updateMany({
    where: { contactId: id, isLatest: true },
    data: { isLatest: false },
  });

  // Get next revision number
  const latestRevision = await prisma.companyEnrichment.findFirst({
    where: { contactId: id },
    orderBy: { revisionNumber: "desc" },
    select: { revisionNumber: true },
  });
  const nextRevision = (latestRevision?.revisionNumber ?? 0) + 1;

  // Create a pending enrichment record first so UI can show progress
  const enrichmentRecord = await prisma.companyEnrichment.create({
    data: {
      contactId: id,
      revisionNumber: nextRevision,
      isLatest: true,
      companyName: contact.company,
      enrichmentStatus: "enriching",
    },
  });

  // Run the enrichment agent in the background
  // We return immediately with the record ID; client can poll for status
  runEnrichmentAgent(
    {
      contactId: id,
      name: contact.name,
      company: contact.company,
      linkedinUrl: contact.linkedinUrl,
      title: contact.title ?? undefined,
      location: undefined,
      officeAddress: contact.officeAddress ?? undefined,
    },
    () => {}, // fire-and-forget events
  ).then(async (result) => {
    if (result) {
      await prisma.companyEnrichment.update({
        where: { id: enrichmentRecord.id },
        data: {
          companyName: result.companyName,
          companyWebsite: result.companyWebsite ?? null,
          companyLogo: result.companyLogo ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          openRoles: (result.openRoles ?? undefined) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          companyValues: (result.companyValues ?? undefined) as any,
          companyMission: result.companyMission ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          officeLocations: (result.officeLocations ?? undefined) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          teamPhotos: (result.teamPhotos ?? undefined) as any,
          enrichmentStatus: "completed",
          errorMessage: null,
        },
      });
    } else {
      await prisma.companyEnrichment.update({
        where: { id: enrichmentRecord.id },
        data: { enrichmentStatus: "failed", errorMessage: "Agent returned no data" },
      });
    }
  }).catch(async (err) => {
    await prisma.companyEnrichment.update({
      where: { id: enrichmentRecord.id },
      data: { enrichmentStatus: "failed", errorMessage: (err as Error).message },
    });
  });

  return NextResponse.json({
    enrichmentId: enrichmentRecord.id,
    revisionNumber: nextRevision,
    status: "enriching",
  });
}

// GET - fetch all enrichment revisions for a contact
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const contact = await prisma.contact.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const enrichments = await prisma.companyEnrichment.findMany({
    where: { contactId: id },
    orderBy: { revisionNumber: "desc" },
  });

  return NextResponse.json({ enrichments });
}

// DELETE - delete a specific enrichment revision
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const { enrichmentId } = await request.json();

  const contact = await prisma.contact.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const enrichment = await prisma.companyEnrichment.findFirst({
    where: { id: enrichmentId, contactId: id },
  });

  if (!enrichment) {
    return NextResponse.json({ error: "Enrichment not found" }, { status: 404 });
  }

  await prisma.companyEnrichment.delete({ where: { id: enrichmentId } });

  // If we deleted the latest, promote the next most recent to latest
  if (enrichment.isLatest) {
    const next = await prisma.companyEnrichment.findFirst({
      where: { contactId: id },
      orderBy: { revisionNumber: "desc" },
    });
    if (next) {
      await prisma.companyEnrichment.update({
        where: { id: next.id },
        data: { isLatest: true },
      });
    }
  }

  return NextResponse.json({ success: true });
}
