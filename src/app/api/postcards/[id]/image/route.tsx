import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const postcard = await prisma.postcard.findUnique({
    where: { id },
    select: { backgroundUrl: true },
  });

  if (!postcard) {
    return new Response("Postcard not found", { status: 404 });
  }

  if (!postcard.backgroundUrl) {
    return new Response("Postcard image not ready", { status: 404 });
  }

  // backgroundUrl is a Supabase storage URL — redirect to it
  return Response.redirect(postcard.backgroundUrl, 302);
}
