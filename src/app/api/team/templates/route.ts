import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/team/templates — list all templates for current team
export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!user.teamId) {
    return NextResponse.json({ templates: [] });
  }

  const templates = await prisma.postcardTemplate.findMany({
    where: { teamId: user.teamId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ templates });
}

// POST /api/team/templates — create a new template
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!user.teamId) {
    return NextResponse.json({ error: "No team — cannot create templates" }, { status: 400 });
  }

  const body = await request.json();
  const { name, description, headline, bodyText, accentColor, backMessage, isDefault } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Template name required" }, { status: 400 });
  }

  // If setting as default, clear existing default first
  if (isDefault) {
    await prisma.postcardTemplate.updateMany({
      where: { teamId: user.teamId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const template = await prisma.postcardTemplate.create({
    data: {
      teamId: user.teamId,
      name: name.trim(),
      description: description?.trim() || null,
      headline: headline?.trim() || null,
      bodyText: bodyText?.trim() || null,
      accentColor: accentColor?.trim() || null,
      backMessage: backMessage?.trim() || null,
      isDefault: !!isDefault,
    },
  });

  return NextResponse.json({ template });
}
