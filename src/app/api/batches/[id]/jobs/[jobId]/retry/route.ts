import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const maxDuration = 600; // 10 minutes

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

  if (job.status !== "failed" && job.status !== "cancelled") {
    return NextResponse.json({ error: "Only failed or cancelled jobs can be retried" }, { status: 400 });
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

  // Also reset batch to processing if it was complete/failed/cancelled
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

      const personName = extractPersonName(job.linkedinUrl);
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

      // Auto-create or update contact with full research log
      const decision = result.decision;
      if (decision) {
        const events = await prisma.agentEvent.findMany({
          where: { jobId },
          orderBy: { createdAt: "asc" },
        });
        const researchLog = buildResearchLog(events);

        const existingContact = await prisma.contact.findFirst({
          where: { userId: user.id, linkedinUrl: job.linkedinUrl },
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
          jobId,
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
              userId: user.id,
              linkedinUrl: job.linkedinUrl,
              ...contactData,
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
    const allDone = allJobs.every((j) => j.status === "complete" || j.status === "failed" || j.status === "cancelled");
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

function extractPersonName(linkedinUrl: string): string | null {
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
