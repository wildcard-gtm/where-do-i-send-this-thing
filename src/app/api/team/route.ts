import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamWithMembers } from "@/lib/team";

// GET /api/team — return current user's team with members + templates
export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!user.teamId) {
    return NextResponse.json({ team: null });
  }

  const team = await getTeamWithMembers(user.teamId);
  if (!team) {
    return NextResponse.json({ team: null });
  }

  return NextResponse.json({ team });
}

// PATCH /api/team — update team name
export async function PATCH(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!user.teamId) {
    return NextResponse.json({ error: "No team" }, { status: 400 });
  }

  // Verify user is an owner
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: user.teamId, userId: user.id } },
  });
  if (!membership || membership.role !== "owner") {
    return NextResponse.json({ error: "Only owners can update the team" }, { status: 403 });
  }

  const { name } = await request.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Team name required" }, { status: 400 });
  }

  const team = await prisma.team.update({
    where: { id: user.teamId },
    data: { name: name.trim() },
  });

  return NextResponse.json({ team });
}
