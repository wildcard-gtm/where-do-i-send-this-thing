import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasourceUrl: process.env.SUPABASE_DB_URL,
    // Limit pool size per serverless function to avoid "Max client connections reached"
    ...(process.env.NODE_ENV === "production" && {
      datasources: {
        db: {
          url: `${process.env.SUPABASE_DB_URL}${process.env.SUPABASE_DB_URL?.includes("?") ? "&" : "?"}connection_limit=3&pool_timeout=10`,
        },
      },
    }),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
