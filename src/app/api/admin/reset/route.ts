import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const DEBUG_KEY = process.env.DEBUG_API_KEY;

function requireKey(request: Request): boolean {
  const header = request.headers.get("x-debug-key");
  const url = new URL(request.url);
  const query = url.searchParams.get("key");
  return !!(DEBUG_KEY && (header === DEBUG_KEY || query === DEBUG_KEY));
}

// POST /api/admin/reset
// Wipes all contacts, scans (batches+jobs), enrichments, and postcards for all users.
// Protected by DEBUG_API_KEY header or ?key= query param.
// Body: { scope?: "all" | "enrichments" | "contacts" | "scans" }
export async function POST(request: Request) {
  if (!requireKey(request)) {
    return NextResponse.json({ error: "Unauthorized — provide x-debug-key header" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const scope: string = body.scope ?? "all";

  const deleted: Record<string, number> = {};

  if (scope === "all" || scope === "enrichments") {
    // Delete enrichment batches (enrichments cascade via FK)
    const eb = await prisma.enrichmentBatch.deleteMany({});
    deleted.enrichmentBatches = eb.count;
    const ce = await prisma.companyEnrichment.deleteMany({});
    deleted.companyEnrichments = ce.count;
  }

  if (scope === "all" || scope === "contacts") {
    // Delete chat messages, feedbacks, revisions, postcards first (cascade not guaranteed on all)
    const postcards = await prisma.postcard.deleteMany({});
    deleted.postcards = postcards.count;
    const msgs = await prisma.chatMessage.deleteMany({});
    deleted.chatMessages = msgs.count;
    const feedbacks = await prisma.feedback.deleteMany({});
    deleted.feedbacks = feedbacks.count;
    const revisions = await prisma.contactRevision.deleteMany({});
    deleted.contactRevisions = revisions.count;
    const contacts = await prisma.contact.deleteMany({});
    deleted.contacts = contacts.count;
  }

  if (scope === "all" || scope === "scans") {
    // Delete agent events, then jobs, then batches
    const events = await prisma.agentEvent.deleteMany({});
    deleted.agentEvents = events.count;
    const jobs = await prisma.job.deleteMany({});
    deleted.jobs = jobs.count;
    const batches = await prisma.batch.deleteMany({});
    deleted.batches = batches.count;
  }

  return NextResponse.json({
    ok: true,
    scope,
    deleted,
    message: `Reset complete for scope="${scope}"`,
  });
}
