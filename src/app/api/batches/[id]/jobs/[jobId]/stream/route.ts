import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runAgentStreaming } from "@/agent/agent-streaming";
import type { AgentStreamEvent } from "@/agent/agent-streaming";

export const maxDuration = 600; // 10 minutes for thorough investigation

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  const user = await getSession();
  if (!user) {
    return new Response("Not authenticated", { status: 401 });
  }

  const { id, jobId } = await params;

  // Verify ownership
  const batch = await prisma.batch.findFirst({
    where: { id, userId: user.id },
    select: { id: true, userId: true, status: true },
  });

  if (!batch) {
    return new Response("Batch not found", { status: 404 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, batchId: id },
  });

  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  // If job is already complete, return stored events as SSE
  if (job.status === "complete" || job.status === "failed") {
    const events = await prisma.agentEvent.findMany({
      where: { jobId },
      orderBy: { createdAt: "asc" },
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const event of events) {
          const sseEvent: AgentStreamEvent = {
            type: event.type as AgentStreamEvent["type"],
            timestamp: event.createdAt.toISOString(),
            iteration: event.iteration ?? undefined,
            data: JSON.parse(event.data),
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(sseEvent)}\n\n`)
          );
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Check if batch was cancelled before starting
  if (batch.status === "cancelled") {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "cancelled" },
    });
    return new Response("Batch cancelled", { status: 409 });
  }

  // Job is pending or running — start streaming
  if (job.status === "pending") {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: "running" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = async (event: AgentStreamEvent) => {
        try {
          // Check if batch was cancelled mid-run
          if (event.type === "iteration_start") {
            const b = await prisma.batch.findUnique({
              where: { id },
              select: { status: true },
            });
            if (b?.status === "cancelled") {
              throw new Error("Batch cancelled by user");
            }
          }

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );

          // Persist event to database
          await prisma.agentEvent.create({
            data: {
              jobId,
              type: event.type,
              iteration: event.iteration,
              data: JSON.stringify(event.data),
            },
          });
        } catch (err) {
          // Re-throw cancellation so the agent loop stops
          if ((err as Error).message === "Batch cancelled by user") throw err;
          // Otherwise stream may have been closed by client
        }
      };

      try {
        const result = await runAgentStreaming(job.linkedinUrl, sendEvent);

        // Extract person name from LinkedIn URL
        const personName = extractPersonName(result);

        // Update job with result
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
        try {
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
        } catch (contactErr) {
          console.error(`Failed to create contact for job ${jobId}:`, contactErr);
        }
      } catch (err) {
        const message = (err as Error).message;
        const isCancelled = message === "Batch cancelled by user";

        if (!isCancelled) {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                type: "error",
                timestamp: new Date().toISOString(),
                data: { message },
              })}\n\n`)
            );
          } catch {
            // Stream already closed
          }
        }

        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: isCancelled ? "cancelled" : "failed",
            result: JSON.stringify({ error: message }),
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function extractPersonName(result: { decision?: { reasoning?: string } | null; input: string }): string | null {
  const urlMatch = result.input.match(/linkedin\.com\/in\/([\w-]+)/);
  if (urlMatch) {
    const parts = urlMatch[1].split("-").filter((w) => !/^\d+$/.test(w));
    while (parts.length > 1 && /^\d/.test(parts[parts.length - 1])) {
      parts.pop();
    }
    if (parts.length > 0) {
      return parts
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
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
