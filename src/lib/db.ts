import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function buildDbUrl() {
  const base = process.env.SUPABASE_DB_URL || "";
  if (process.env.NODE_ENV !== "production") return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}connection_limit=3&pool_timeout=10`;
}

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ datasourceUrl: buildDbUrl() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
