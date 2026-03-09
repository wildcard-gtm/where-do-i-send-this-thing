import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import { uploadReferenceImage } from "@/lib/supabase-storage";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const teamUserIds = await getTeamUserIds(user);

  const existing = await prisma.contact.findFirst({
    where: { id, userId: { in: teamUserIds } },
  });

  if (!existing) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("photo") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No photo provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.type === "image/jpeg" ? "jpg" : "png";
  const filePath = `photos/${id}-${Date.now()}.${ext}`;

  const publicUrl = await uploadReferenceImage(buffer, filePath, file.type);

  const contact = await prisma.contact.update({
    where: { id },
    data: { profileImageUrl: publicUrl },
  });

  return NextResponse.json({ contact, profileImageUrl: publicUrl });
}
