import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type LogLevel = "info" | "warn" | "error";

export type LogSource =
  | "gemini"
  | "openai"
  | "bedrock"
  | "bright_data"
  | "endato"
  | "propmix"
  | "exa_ai"
  | "firecrawl"
  | "linkedin_mcp"
  | "pdl"
  | "google_maps"
  | "hunter_io"
  | "brandfetch"
  | "logo_dev"
  | "supabase"
  | "system";

export interface LogMeta {
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  model?: string;
  error?: string;
  [key: string]: unknown;
}

/**
 * Write a structured log entry to the AppLog table.
 * Swallows all errors silently — never crashes the caller.
 *
 * For hot paths, call fire-and-forget: `appLog(...).catch(() => {})`
 */
export async function appLog(
  level: LogLevel,
  source: LogSource,
  action: string,
  message: string,
  meta?: LogMeta,
): Promise<void> {
  try {
    await prisma.appLog.create({
      data: {
        level,
        source,
        action,
        message,
        meta: meta ? (meta as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch {
    // Silently swallow — logging must never break the caller
  }
}
