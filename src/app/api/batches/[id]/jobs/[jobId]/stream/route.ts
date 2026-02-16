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
    select: { id: true },
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
        } catch {
          // Stream may have been closed by client
        }
      };

      try {
        const result = await runAgentStreaming(job.linkedinUrl, sendEvent);

        // Update job with result
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: "complete",
            recommendation: result.decision?.recommendation ?? null,
            confidence: result.decision?.confidence ?? null,
            result: JSON.stringify(result),
          },
        });
      } catch (err) {
        await sendEvent({
          type: "error",
          timestamp: new Date().toISOString(),
          data: { message: (err as Error).message },
        });

        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: "failed",
            result: JSON.stringify({ error: (err as Error).message }),
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
