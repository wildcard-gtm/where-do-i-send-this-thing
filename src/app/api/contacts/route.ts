import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const recommendation = url.searchParams.get("recommendation") || "";
  const sort = url.searchParams.get("sort") || "createdAt";
  const order = url.searchParams.get("order") || "desc";
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "20");

  const where: Record<string, unknown> = { userId: user.id };

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { company: { contains: search } },
      { email: { contains: search } },
      { linkedinUrl: { contains: search } },
    ];
  }

  if (recommendation) {
    where.recommendation = recommendation;
  }

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.contact.count({ where }),
  ]);

  return NextResponse.json({ contacts, total, page });
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, linkedinUrl, email, company, title, notes } = body;

    if (!name || !linkedinUrl) {
      return NextResponse.json(
        { error: "Name and LinkedIn URL are required" },
        { status: 400 }
      );
    }

    const contact = await prisma.contact.create({
      data: {
        userId: user.id,
        name,
        linkedinUrl,
        email: email || null,
        company: company || null,
        title: title || null,
        notes: notes || null,
      },
    });

    return NextResponse.json({ contact });
  } catch {
    return NextResponse.json(
      { error: "Failed to create contact" },
      { status: 500 }
    );
  }
}
