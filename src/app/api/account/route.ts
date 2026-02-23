import { NextResponse } from "next/server";
import { getSession, signToken, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

// GET /api/account — fetch current user profile
export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, name: true, email: true, role: true, teamId: true, createdAt: true },
  });

  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user: dbUser });
}

// PATCH /api/account — update name or password
export async function PATCH(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const { name, currentPassword, newPassword } = body;

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};

  if (name?.trim()) {
    updateData.name = name.trim();
  }

  if (newPassword) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Current password required" }, { status: 400 });
    }
    const valid = await bcrypt.compare(currentPassword, dbUser.password);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }
    updateData.password = await bcrypt.hash(newPassword, 10);
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: updateData,
    select: { id: true, name: true, email: true, role: true, teamId: true },
  });

  // Refresh session cookie with new name if changed
  if (updateData.name) {
    const token = await signToken({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      teamId: updated.teamId ?? null,
    });
    await setSessionCookie(token);
  }

  return NextResponse.json({ user: updated });
}
