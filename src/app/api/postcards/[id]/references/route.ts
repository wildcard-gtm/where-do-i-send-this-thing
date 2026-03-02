import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

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

  const postcard = await prisma.postcard.findFirst({
    where: { id, contact: { userId: { in: teamUserIds } } },
    select: {
      references: {
        select: { id: true, label: true, imageUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!postcard) {
    return NextResponse.json({ error: "Postcard not found" }, { status: 404 });
  }

  return NextResponse.json({ references: postcard.references });
}
