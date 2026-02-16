import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  // Validate the contact belongs to the user
  const contact = await prisma.contact.findFirst({
    where: { id, userId: user.id },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const feedback = await prisma.feedback.findFirst({
    where: { contactId: id, userId: user.id },
  });

  return NextResponse.json({ feedback });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  // Validate the contact belongs to the user
  const contact = await prisma.contact.findFirst({
    where: { id, userId: user.id },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const body = await request.json();
  const { rating, comment } = body;

  if (!rating || (rating !== "like" && rating !== "dislike")) {
    return NextResponse.json(
      { error: "Rating must be 'like' or 'dislike'" },
      { status: 400 }
    );
  }

  // Upsert: if feedback already exists for this contact+user, update it
  const existing = await prisma.feedback.findFirst({
    where: { contactId: id, userId: user.id },
  });

  let feedback;
  if (existing) {
    feedback = await prisma.feedback.update({
      where: { id: existing.id },
      data: { rating, comment: comment || null },
    });
  } else {
    feedback = await prisma.feedback.create({
      data: {
        contactId: id,
        userId: user.id,
        rating,
        comment: comment || null,
      },
    });
  }

  return NextResponse.json({ feedback });
}
