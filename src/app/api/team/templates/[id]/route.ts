import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/team/templates/[id] — fetch a single template
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const template = await prisma.postcardTemplate.findFirst({
    where: { id, teamId: user.teamId ?? undefined },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ template });
}

// PATCH /api/team/templates/[id] — update a template
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!user.teamId) {
    return NextResponse.json({ error: "No team" }, { status: 400 });
  }

  const { id } = await params;

  const existing = await prisma.postcardTemplate.findFirst({
    where: { id, teamId: user.teamId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = await request.json();
  const { name, description, headline, bodyText, accentColor, backMessage, isDefault } = body;

  // If setting as default, clear existing default first
  if (isDefault && !existing.isDefault) {
    await prisma.postcardTemplate.updateMany({
      where: { teamId: user.teamId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const allowedFields: Record<string, unknown> = {};
  if ("name" in body && name?.trim()) allowedFields.name = name.trim();
  if ("description" in body) allowedFields.description = description?.trim() || null;
  if ("headline" in body) allowedFields.headline = headline?.trim() || null;
  if ("bodyText" in body) allowedFields.bodyText = bodyText?.trim() || null;
  if ("accentColor" in body) allowedFields.accentColor = accentColor?.trim() || null;
  if ("backMessage" in body) allowedFields.backMessage = backMessage?.trim() || null;
  if ("isDefault" in body) allowedFields.isDefault = !!isDefault;

  const template = await prisma.postcardTemplate.update({
    where: { id },
    data: allowedFields,
  });

  return NextResponse.json({ template });
}

// DELETE /api/team/templates/[id] — delete a template
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!user.teamId) {
    return NextResponse.json({ error: "No team" }, { status: 400 });
  }

  const { id } = await params;

  const existing = await prisma.postcardTemplate.findFirst({
    where: { id, teamId: user.teamId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  await prisma.postcardTemplate.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
