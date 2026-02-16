import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const fullUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, name: true, autoProcess: true },
  });

  return NextResponse.json({ user: fullUser });
}

export async function PATCH(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const data: Record<string, unknown> = {};

  if ("autoProcess" in body) {
    data.autoProcess = Boolean(body.autoProcess);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: { id: true, email: true, name: true, autoProcess: true },
  });

  return NextResponse.json({ user: updated });
}
