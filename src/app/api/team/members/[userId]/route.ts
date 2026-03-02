import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// DELETE /api/team/members/[userId] — remove a member from the team (owner only)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!user.teamId) {
    return NextResponse.json({ error: "No team" }, { status: 400 });
  }

  // Only owners can remove members
  const myMembership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: user.teamId, userId: user.id } },
  });
  if (!myMembership || myMembership.role !== "owner") {
    return NextResponse.json({ error: "Only owners can remove members" }, { status: 403 });
  }

  const { userId } = await params;

  if (userId === user.id) {
    return NextResponse.json({ error: "Use the leave endpoint to remove yourself" }, { status: 400 });
  }

  const targetMembership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: user.teamId, userId } },
  });
  if (!targetMembership) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  await prisma.teamMember.delete({
    where: { teamId_userId: { teamId: user.teamId, userId } },
  });
  await prisma.user.update({ where: { id: userId }, data: { teamId: null } });

  return NextResponse.json({ success: true });
}

// PATCH /api/team/members/[userId] — change member role (owner only)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!user.teamId) {
    return NextResponse.json({ error: "No team" }, { status: 400 });
  }

  const myMembership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: user.teamId, userId: user.id } },
  });
  if (!myMembership || myMembership.role !== "owner") {
    return NextResponse.json({ error: "Only owners can change roles" }, { status: 403 });
  }

  const { userId } = await params;
  const { role } = await request.json();

  if (!["owner", "member"].includes(role)) {
    return NextResponse.json({ error: "Role must be owner or member" }, { status: 400 });
  }

  const updated = await prisma.teamMember.update({
    where: { teamId_userId: { teamId: user.teamId, userId } },
    data: { role },
  });

  return NextResponse.json({ member: updated });
}
