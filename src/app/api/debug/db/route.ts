import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const count = await prisma.user.count();
    return NextResponse.json({
      ok: true,
      userCount: count,
      envCheck: {
        SUPABASE_DB_URL: !!process.env.SUPABASE_DB_URL,
        SUPABASE_DB_URL_DIRECT: !!process.env.SUPABASE_DB_URL_DIRECT,
        DATABASE_URL: !!process.env.DATABASE_URL,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      envCheck: {
        SUPABASE_DB_URL: !!process.env.SUPABASE_DB_URL,
        SUPABASE_DB_URL_DIRECT: !!process.env.SUPABASE_DB_URL_DIRECT,
        DATABASE_URL: !!process.env.DATABASE_URL,
      },
    }, { status: 500 });
  }
}
