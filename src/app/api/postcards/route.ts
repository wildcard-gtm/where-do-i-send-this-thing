import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET — all postcards for current user
export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const contactId = searchParams.get("contactId");

  const where: Record<string, unknown> = {
    contact: { userId: user.id },
  };
  if (status) where.status = status;
  if (contactId) where.contactId = contactId;

  const postcards = await prisma.postcard.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      contact: { select: { id: true, name: true, company: true } },
    },
  });

  return NextResponse.json({ postcards });
}
