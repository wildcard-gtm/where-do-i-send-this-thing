import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { signToken, setSessionCookie } from "@/lib/auth";
import bcrypt from "bcryptjs";

// POST /api/team/invite
// Body: { email: string, password?: string, name?: string }
// If the user exists, adds them to the team.
// If not and password is provided, creates the account then adds them.
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!user.teamId) {
    return NextResponse.json({ error: "You are not in a team" }, { status: 400 });
  }

  // Only owners can invite
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: user.teamId, userId: user.id } },
  });
  if (!membership || membership.role !== "owner") {
    return NextResponse.json({ error: "Only owners can invite members" }, { status: 403 });
  }

  const { email, password, name } = await request.json();
  if (!email?.trim()) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  let invitee = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!invitee) {
    // Create the account if a password was supplied
    if (!password?.trim()) {
      return NextResponse.json({
        error: "No account found for that email. Provide a password to create one.",
        needsPassword: true,
      }, { status: 404 });
    }
    const hashed = await bcrypt.hash(password, 10);
    invitee = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        password: hashed,
        name: name?.trim() || email.split("@")[0],
        role: "user",
        teamId: user.teamId,
      },
    });
    // Add TeamMember record
    await prisma.teamMember.create({
      data: { teamId: user.teamId, userId: invitee.id, role: "member" },
    });
    return NextResponse.json({
      success: true,
      created: true,
      message: `Account created and ${invitee.name} has been added to the team.`,
    });
  }

  if (invitee.id === user.id) {
    return NextResponse.json({ error: "You are already in the team" }, { status: 400 });
  }

  // Check if already a member
  const existing = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: user.teamId, userId: invitee.id } },
  });
  if (existing) {
    return NextResponse.json({ error: "This person is already a team member" }, { status: 400 });
  }

  // Add to team
  await prisma.teamMember.create({
    data: { teamId: user.teamId, userId: invitee.id, role: "member" },
  });

  // Stamp teamId on their account
  await prisma.user.update({
    where: { id: invitee.id },
    data: { teamId: user.teamId },
  });

  return NextResponse.json({
    success: true,
    created: false,
    message: `${invitee.name} has been added to the team.`,
  });
}

// DELETE /api/team/invite — remove self from team (leave)
export async function DELETE() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!user.teamId) {
    return NextResponse.json({ error: "Not in a team" }, { status: 400 });
  }

  // Check if last owner — prevent orphaning
  const ownerCount = await prisma.teamMember.count({
    where: { teamId: user.teamId, role: "owner" },
  });
  const myRole = (await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: user.teamId, userId: user.id } },
    select: { role: true },
  }))?.role;

  if (myRole === "owner" && ownerCount <= 1) {
    return NextResponse.json({
      error: "You are the only owner. Transfer ownership before leaving.",
    }, { status: 400 });
  }

  await prisma.teamMember.delete({
    where: { teamId_userId: { teamId: user.teamId, userId: user.id } },
  });
  await prisma.user.update({ where: { id: user.id }, data: { teamId: null } });

  // Refresh session without teamId
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (dbUser) {
    const token = await signToken({
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      teamId: null,
    });
    await setSessionCookie(token);
  }

  return NextResponse.json({ success: true });
}
