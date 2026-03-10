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
    include: {
      contact: {
        select: {
          id: true, name: true, company: true, title: true, linkedinUrl: true, profileImageUrl: true,
          companyEnrichments: {
            where: { isLatest: true },
            take: 1,
            select: {
              companyName: true,
              companyLogo: true,
              teamPhotos: true,
              openRoles: true,
              companyValues: true,
              companyMission: true,
              officeLocations: true,
            },
          },
        },
      },
    },
  });

  return NextResponse.json({ postcards });
}
