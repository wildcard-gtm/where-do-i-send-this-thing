import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const user = await getSession();
  if (!user) return null;
  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (dbUser?.role !== "admin") return null;
  return user;
}

export async function GET() {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const prompts = await prisma.systemPrompt.findMany({
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ prompts });
}

export async function PUT(request: Request) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id, content } = await request.json();

  if (!id || typeof content !== "string") {
    return NextResponse.json({ error: "ID and content are required" }, { status: 400 });
  }

  const prompt = await prisma.systemPrompt.update({
    where: { id },
    data: { content },
  });

  return NextResponse.json({ prompt });
}
