import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runAgentStreaming } from "@/agent/agent-streaming";
import type { AgentStreamEvent } from "@/agent/agent-streaming";

export const maxDuration = 600; // 10 minutes for thorough investigation

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

  // Fire and forget: process ALL jobs in parallel
  processJobsInParallel(batch.id, batch.userId, batch.jobs).catch(console.error);

  return NextResponse.json({ status: "started" });
}

const CONCURRENCY_LIMIT = 5;

export async function processJobsInParallel(
  batchId: string,
  userId: string,
  jobs: Array<{ id: string; linkedinUrl: string; status: string }>
) {
  const pendingJobs = jobs.filter((j) => j.status === "pending");

  // Run jobs with concurrency pool of 5
  let index = 0;
  const runNext = async (): Promise<void> => {
    while (index < pendingJobs.length) {
      const job = pendingJobs[index++];
      await processOneJob(batchId, userId, job);
    }
  };

  // Start up to CONCURRENCY_LIMIT workers
  const workers = Array.from(
    { length: Math.min(CONCURRENCY_LIMIT, pendingJobs.length) },
    () => runNext()
  );
  await Promise.allSettled(workers);

  // Check final batch status
  await finalizeBatchStatus(batchId);
}

async function processOneJob(
  batchId: string,
  userId: string,
  job: { id: string; linkedinUrl: string }
) {
  try {
    // Check if batch was cancelled before starting
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { status: true },
    });
    if (batch?.status === "cancelled") {
      // Mark this job as cancelled so it doesn't stay orphaned as "pending"
      await prisma.job.update({
        where: { id: job.id },
        data: { status: "cancelled" },
      });
      return;
    }

    // Mark job as running
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "running" },
    });

    // Run agent with streaming events persisted to DB
    const result = await runAgentStreaming(
      job.linkedinUrl,
      async (event: AgentStreamEvent) => {
        // Check if batch was cancelled mid-run
        if (event.type === "iteration_start") {
          const b = await prisma.batch.findUnique({
            where: { id: batchId },
            select: { status: true },
          });
          if (b?.status === "cancelled") {
            throw new Error("Batch cancelled by user");
          }
        }

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
        // Also build the full research log from events
        const events = await prisma.agentEvent.findMany({
          where: { jobId: job.id },
          orderBy: { createdAt: "asc" },
        });
        const researchLog = buildResearchLog(events);

        const existingContact = await prisma.contact.findFirst({
          where: { userId, linkedinUrl: job.linkedinUrl },
        });

        const contactData = {
          name: personName || "Unknown",
          recommendation: decision.recommendation,
          confidence: decision.confidence,
          homeAddress: decision.home_address?.address || null,
          officeAddress: decision.office_address?.address || null,
          profileImageUrl: decision.profile_image_url || null,
          careerSummary: decision.career_summary || null,
          lastScannedAt: new Date(),
          jobId: job.id,
          notes: researchLog,
        };

        if (existingContact) {
          await prisma.contact.update({
            where: { id: existingContact.id },
            data: {
              ...contactData,
              name: personName || existingContact.name,
              homeAddress: contactData.homeAddress || existingContact.homeAddress,
              officeAddress: contactData.officeAddress || existingContact.officeAddress,
              profileImageUrl: contactData.profileImageUrl || existingContact.profileImageUrl,
              careerSummary: contactData.careerSummary || existingContact.careerSummary,
            },
          });
        } else {
          await prisma.contact.create({
            data: {
              userId,
              linkedinUrl: job.linkedinUrl,
              ...contactData,
            },
          });
        }
      }
    } catch (contactErr) {
      console.error(`Failed to create contact for job ${job.id}:`, contactErr);
    }
  } catch (err) {
    const message = (err as Error).message;
    console.error(`Job ${job.id} failed:`, message);

    // If cancelled, mark job as cancelled not failed
    const isCancelled = message === "Batch cancelled by user";
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: isCancelled ? "cancelled" : "failed",
        result: JSON.stringify({ error: message }),
      },
    });
  }
}

async function finalizeBatchStatus(batchId: string) {
  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    select: { status: true },
  });
  // Don't override if already cancelled
  if (batch?.status === "cancelled") return;

  const allJobs = await prisma.job.findMany({
    where: { batchId },
    select: { status: true },
  });

  const allDone = allJobs.every(
    (j) => j.status === "complete" || j.status === "failed" || j.status === "cancelled"
  );
  const anyFailed = allJobs.some((j) => j.status === "failed");

  if (allDone) {
    await prisma.batch.update({
      where: { id: batchId },
      data: { status: anyFailed ? "failed" : "complete" },
    });
  }
}

/**
 * Build a human-readable research log from agent events.
 * This gets stored in contact.notes so the chat has full context.
 */
function buildResearchLog(events: Array<{ type: string; data: string; iteration: number | null }>): string {
  const lines: string[] = ["=== FULL RESEARCH LOG ===\n"];

  for (const event of events) {
    try {
      const data = JSON.parse(event.data);

      switch (event.type) {
        case "thinking":
          lines.push(`[Agent Reasoning]\n${data.text}\n`);
          break;
        case "tool_call_start":
          lines.push(`[Tool Call: ${data.toolName}]\nInput: ${JSON.stringify(data.toolInput, null, 2)}\n`);
          break;
        case "tool_call_result":
          lines.push(`[Tool Result: ${data.toolName}] ${data.success ? "Success" : "Failed"}\nSummary: ${data.summary}\n${data.data ? `Data: ${JSON.stringify(data.data, null, 2)}\n` : ""}`);
          break;
        case "decision_accepted":
          lines.push(`[Decision Accepted]\n${JSON.stringify(data.decision, null, 2)}\n`);
          break;
        case "decision_rejected":
          lines.push(`[Decision Rejected] Confidence ${data.confidence}% below ${data.threshold}% threshold\n`);
          break;
        case "error":
          lines.push(`[Error] ${data.message}\n`);
          break;
      }
    } catch {
      // Skip unparseable events
    }
  }

  return lines.join("\n");
}

function extractPersonName(result: { decision?: { reasoning?: string } | null; input: string }): string | null {
  const urlMatch = result.input.match(/linkedin\.com\/in\/([\w-]+)/);
  if (urlMatch) {
    return urlMatch[1]
      .split("-")
      .filter((w) => !/^\d+$/.test(w))
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return null;
}
