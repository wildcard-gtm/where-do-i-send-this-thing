import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

// GET /api/postcard-batches/[id]
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

  const contactSelect = {
    id: true, name: true, company: true, title: true, linkedinUrl: true,
    recommendation: true, homeAddress: true, officeAddress: true,
  } as const;

  const batch = await prisma.postcardBatch.findFirst({
    where: { id, userId: { in: teamUserIds } },
    include: {
      postcards: {
        include: { contact: { select: contactSelect } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Postcard batch not found" }, { status: 404 });
  }

  // Helper: compute contactName + deliveryAddress from Contact relation
  const addContactFields = (b: typeof batch) => ({
    ...b,
    postcards: b.postcards.map((p) => {
      const c = p.contact;
      return {
        ...p,
        contactName: c?.name ?? "Unknown",
        deliveryAddress: c
          ? c.recommendation === "HOME" ? c.homeAddress
            : c.recommendation === "OFFICE" ? c.officeAddress
            : c.homeAddress || c.officeAddress
          : null,
      };
    }),
  });

  // Auto-recover stale "generating" postcards (stuck > 10 min)
  const STALE_THRESHOLD = new Date(Date.now() - 10 * 60 * 1000);
  const staleReset = await prisma.postcard.updateMany({
    where: {
      postcardBatchId: id,
      status: "generating",
      updatedAt: { lt: STALE_THRESHOLD },
    },
    data: { status: "failed", errorMessage: "Timed out — generation took too long" },
  });
  if (staleReset.count > 0) {
    const updated = await prisma.postcardBatch.findFirst({
      where: { id, userId: { in: teamUserIds } },
      include: {
        postcards: {
          include: { contact: { select: contactSelect } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return NextResponse.json({ batch: updated ? addContactFields(updated) : updated });
  }

  return NextResponse.json({ batch: addContactFields(batch) });
}
