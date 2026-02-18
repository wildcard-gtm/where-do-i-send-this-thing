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

  const contact = await prisma.contact.findFirst({
    where: { id, userId: user.id },
    include: {
      job: {
        select: {
          id: true,
          batchId: true,
          status: true,
          result: true,
          linkedinUrl: true,
          personName: true,
        },
      },
      chatMessages: {
        orderBy: { createdAt: "asc" },
        take: 50,
      },
    },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  // Fetch role from DB (JWT may be stale)
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  });

  return NextResponse.json({ contact, userRole: dbUser?.role ?? "user" });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.contact.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const body = await request.json();
  const allowedFields = ["name", "email", "company", "title", "notes", "homeAddress", "officeAddress"];
  const data: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (field in body) {
      data[field] = body[field];
    }
  }

  const contact = await prisma.contact.update({
    where: { id },
    data,
  });

  return NextResponse.json({ contact });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.contact.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  await prisma.contact.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
