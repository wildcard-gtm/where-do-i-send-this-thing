import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET all scan revisions for a contact
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

  const revisions = await prisma.contactRevision.findMany({
    where: { contactId: id },
    orderBy: { revisionNumber: "desc" },
  });

  return NextResponse.json({ revisions });
}

// DELETE a specific scan revision
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const { revisionId } = await request.json();

  const contact = await prisma.contact.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const revision = await prisma.contactRevision.findFirst({
    where: { id: revisionId, contactId: id },
  });

  if (!revision) {
    return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  }

  await prisma.contactRevision.delete({ where: { id: revisionId } });

  return NextResponse.json({ success: true });
}

// POST - restore a revision (copy its data back to the contact)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const { revisionId } = await request.json();

  const contact = await prisma.contact.findFirst({
    where: { id, userId: user.id },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const revision = await prisma.contactRevision.findFirst({
    where: { id: revisionId, contactId: id },
  });

  if (!revision) {
    return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  }

  // Before restoring, save current state as a new revision
  const latestRevision = await prisma.contactRevision.findFirst({
    where: { contactId: id },
    orderBy: { revisionNumber: "desc" },
    select: { revisionNumber: true },
  });
  const nextRevision = (latestRevision?.revisionNumber ?? 0) + 1;

  await prisma.contactRevision.updateMany({
    where: { contactId: id, isLatest: true },
    data: { isLatest: false },
  });

  await prisma.contactRevision.create({
    data: {
      contactId: id,
      revisionNumber: nextRevision,
      isLatest: true,
      name: contact.name,
      email: contact.email,
      linkedinUrl: contact.linkedinUrl,
      company: contact.company,
      title: contact.title,
      profileImageUrl: contact.profileImageUrl,
      careerSummary: contact.careerSummary,
      homeAddress: contact.homeAddress,
      officeAddress: contact.officeAddress,
      recommendation: contact.recommendation,
      confidence: contact.confidence,
    },
  });

  // Restore revision data to contact
  const updated = await prisma.contact.update({
    where: { id },
    data: {
      name: revision.name,
      email: revision.email,
      company: revision.company,
      title: revision.title,
      profileImageUrl: revision.profileImageUrl,
      careerSummary: revision.careerSummary,
      homeAddress: revision.homeAddress,
      officeAddress: revision.officeAddress,
      recommendation: revision.recommendation,
      confidence: revision.confidence,
    },
  });

  return NextResponse.json({ contact: updated });
}
