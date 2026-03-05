import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

// GET /api/contacts/[id]/postcards
// Returns all postcards for a contact, newest first
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const teamUserIds = await getTeamUserIds(user);

  const contact = await prisma.contact.findFirst({
    where: { id, userId: { in: teamUserIds } },
    select: { id: true },
  });

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const postcards = await prisma.postcard.findMany({
    where: { contactId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      template: true,
      imageUrl: true,
      errorMessage: true,
      createdAt: true,
      contactPhoto: true,
      teamPhotos: true,
      companyLogo: true,
      contactName: true,
      contactTitle: true,
      openRoles: true,
      customPrompt: true,
      backMessage: true,
      parentPostcardId: true,
    },
  });

  return NextResponse.json({ postcards });
}
