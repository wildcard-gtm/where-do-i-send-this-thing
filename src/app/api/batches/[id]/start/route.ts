import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runAgentStreaming } from "@/agent/agent-streaming";
import type { AgentStreamEvent } from "@/agent/agent-streaming";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const batch = await prisma.batch.findFirst({
    where: { id, userId: user.id },
    include: { jobs: { orderBy: { createdAt: "asc" } } },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  if (batch.status === "processing") {
    return NextResponse.json(
      { error: "Batch is already processing" },
      { status: 400 }
    );
  }

  // Mark batch as processing
  await prisma.batch.update({
    where: { id },
    data: { status: "processing" },
  });

  // Fire and forget: process jobs sequentially in the background
  processJobsSequentially(batch.id, batch.userId, batch.jobs).catch(console.error);

  return NextResponse.json({ status: "started" });
}

export async function processJobsSequentially(
  batchId: string,
  userId: string,
  jobs: Array<{ id: string; linkedinUrl: string; status: string }>
) {
  const pendingJobs = jobs.filter((j) => j.status === "pending");

  for (const job of pendingJobs) {
    try {
      // Mark job as running
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "running" },
      });

      // Run agent with streaming events persisted to DB
      const result = await runAgentStreaming(
        job.linkedinUrl,
        async (event: AgentStreamEvent) => {
          await prisma.agentEvent.create({
            data: {
              jobId: job.id,
              type: event.type,
              iteration: event.iteration,
              data: JSON.stringify(event.data),
            },
          });
        }
      );

      // Update job with result
      const personName = extractPersonName(result);
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "complete",
          personName,
          recommendation: result.decision?.recommendation ?? null,
          confidence: result.decision?.confidence ?? null,
          result: JSON.stringify(result),
        },
      });

      // Auto-create or update contact
      try {
        const decision = result.decision;
        if (decision) {
          const existingContact = await prisma.contact.findFirst({
            where: { userId, linkedinUrl: job.linkedinUrl },
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
                profileImageUrl: decision.profile_image_url || existingContact.profileImageUrl,
                careerSummary: decision.career_summary || existingContact.careerSummary,
                lastScannedAt: new Date(),
                jobId: job.id,
              },
            });
          } else {
            await prisma.contact.create({
              data: {
                userId,
                name: personName || "Unknown",
                linkedinUrl: job.linkedinUrl,
                homeAddress: decision.home_address?.address || null,
                officeAddress: decision.office_address?.address || null,
                profileImageUrl: decision.profile_image_url || null,
                careerSummary: decision.career_summary || null,
                recommendation: decision.recommendation,
                confidence: decision.confidence,
                lastScannedAt: new Date(),
                jobId: job.id,
              },
            });
          }
        }
      } catch (contactErr) {
        console.error(`Failed to create contact for job ${job.id}:`, contactErr);
      }
    } catch (err) {
      console.error(`Job ${job.id} failed:`, err);

      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          result: JSON.stringify({ error: (err as Error).message }),
        },
      });
    }
  }

  // Check final batch status
  const allJobs = await prisma.job.findMany({
    where: { batchId },
    select: { status: true },
  });

  const allDone = allJobs.every(
    (j) => j.status === "complete" || j.status === "failed"
  );
  const anyFailed = allJobs.some((j) => j.status === "failed");

  if (allDone) {
    await prisma.batch.update({
      where: { id: batchId },
      data: { status: anyFailed ? "failed" : "complete" },
    });
  }
}

function extractPersonName(result: { decision?: { reasoning?: string } | null; input: string }): string | null {
  // Try to extract from the input URL
  const urlMatch = result.input.match(/linkedin\.com\/in\/([\w-]+)/);
  if (urlMatch) {
    return urlMatch[1]
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return null;
}
