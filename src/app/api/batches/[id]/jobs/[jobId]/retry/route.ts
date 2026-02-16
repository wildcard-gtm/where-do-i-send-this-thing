import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id, jobId } = await params;

  const batch = await prisma.batch.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, batchId: id },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "failed") {
    return NextResponse.json({ error: "Only failed jobs can be retried" }, { status: 400 });
  }

  // Clear old events and reset job
  await prisma.agentEvent.deleteMany({ where: { jobId } });
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "pending",
      recommendation: null,
      confidence: null,
      result: null,
      personName: null,
    },
  });

  // Also reset batch to processing if it was complete/failed
  await prisma.batch.update({
    where: { id },
    data: { status: "processing" },
  });

  // Import and run agent in background
  const { runAgentStreaming } = await import("@/agent/agent-streaming");

  // Fire and forget
  (async () => {
    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "running" },
      });

      const result = await runAgentStreaming(
        job.linkedinUrl,
        async (event: { type: string; timestamp: string; iteration?: number; data: Record<string, unknown> }) => {
          await prisma.agentEvent.create({
            data: {
              jobId,
              type: event.type,
              iteration: event.iteration,
              data: JSON.stringify(event.data),
            },
          });
        }
      );

      const personName = extractPersonName(result, job.linkedinUrl);
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "complete",
          personName,
          recommendation: result.decision?.recommendation ?? null,
          confidence: result.decision?.confidence ?? null,
          result: JSON.stringify(result),
        },
      });

      // Auto-create or update contact
      const decision = result.decision;
      if (decision) {
        const existingContact = await prisma.contact.findFirst({
          where: { userId: user.id, linkedinUrl: job.linkedinUrl },
        });

        if (existingContact) {
          await prisma.contact.update({
            where: { id: existingContact.id },
            data: {
              name: personName || existingContact.name,
              recommendation: decision.recommendation,
              confidence: decision.confidence,
              homeAddress: decision.home_address?.address || existingContact.homeAddress,
              officeAddress: decision.office_address?.address || existingContact.officeAddress,
              lastScannedAt: new Date(),
              jobId,
            },
          });
        } else {
          await prisma.contact.create({
            data: {
              userId: user.id,
              name: personName || "Unknown",
              linkedinUrl: job.linkedinUrl,
              homeAddress: decision.home_address?.address || null,
              officeAddress: decision.office_address?.address || null,
              recommendation: decision.recommendation,
              confidence: decision.confidence,
              lastScannedAt: new Date(),
              jobId,
            },
          });
        }
      }
    } catch (err) {
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: "failed",
          result: JSON.stringify({ error: (err as Error).message }),
        },
      });
    }

    // Check batch status
    const allJobs = await prisma.job.findMany({
      where: { batchId: id },
      select: { status: true },
    });
    const allDone = allJobs.every((j) => j.status === "complete" || j.status === "failed");
    const anyFailed = allJobs.some((j) => j.status === "failed");
    if (allDone) {
      await prisma.batch.update({
        where: { id },
        data: { status: anyFailed ? "failed" : "complete" },
      });
    }
  })();

  return NextResponse.json({ status: "retrying" });
}

function extractPersonName(result: { input: string }, linkedinUrl: string): string | null {
  const urlMatch = linkedinUrl.match(/linkedin\.com\/in\/([\w-]+)/);
  if (urlMatch) {
    return urlMatch[1]
      .split("-")
      .filter((w) => !/^\d+$/.test(w))
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return null;
}
