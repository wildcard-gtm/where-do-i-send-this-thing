import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runAgentStreaming } from "@/agent/agent-streaming";
import type { AgentStreamEvent } from "@/agent/agent-streaming";
import { getTeamUserIds } from "@/lib/team";
import { appLog } from "@/lib/app-log";
import { isPlaceholderUrl } from "@/lib/photo-finder/detect-placeholder";
import { fetchBrightDataLinkedIn, enrichWithPDL, searchExaPerson } from "@/agent/services";

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
    where: { id, userId: { in: await getTeamUserIds(user) } },
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

  // Check if batch or job was cancelled before starting
  if (batch.status === "cancelled" || job.status === "cancelled") {
    if (job.status !== "cancelled") {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: "cancelled" },
      });
    }
    return new Response("Cancelled", { status: 409 });
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
      let enrichedName: string | null = null;

      const sendEvent = async (event: AgentStreamEvent) => {
        try {
          // Check if batch or job was cancelled mid-run
          if (event.type === "iteration_start") {
            const [b, j] = await Promise.all([
              prisma.batch.findUnique({ where: { id }, select: { status: true } }),
              prisma.job.findUnique({ where: { id: jobId }, select: { status: true } }),
            ]);
            if (b?.status === "cancelled" || j?.status === "cancelled") {
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

          // Extract real name from LinkedIn enrichment as soon as it returns
          if (
            event.type === "tool_call_result" &&
            event.data &&
            typeof event.data === "object" &&
            "toolName" in event.data &&
            (event.data as Record<string, unknown>).toolName === "enrich_linkedin_profile" &&
            (event.data as Record<string, unknown>).success
          ) {
            const enrichData = (event.data as Record<string, unknown>).data as Record<string, unknown> | undefined;
            if (enrichData?.name && typeof enrichData.name === "string") {
              enrichedName = enrichData.name;
              await prisma.job.update({
                where: { id: jobId },
                data: { personName: enrichedName },
              });
            }
          }
        } catch (err) {
          // Re-throw cancellation so the agent loop stops
          if ((err as Error).message === "Batch cancelled by user") throw err;
          // Otherwise stream may have been closed by client
        }
      };

      appLog("info", "system", "scan_start", `Scan started for job ${jobId}: ${job.linkedinUrl}`, { jobId, batchId: id }).catch(() => {});

      try {
        const result = await runAgentStreaming(job.linkedinUrl, sendEvent, job.csvRowData ?? undefined);

        // Use enriched name if available, otherwise fall back to URL-based extraction
        const personName = enrichedName || extractPersonName(result);

        // Update job with result (+ corrected LinkedIn URL if agent found one)
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: "complete",
            personName,
            recommendation: result.decision?.recommendation ?? null,
            confidence: result.decision?.confidence ?? null,
            result: JSON.stringify(result),
            ...(result.decision?.corrected_linkedin_url
              ? { linkedinUrl: result.decision.corrected_linkedin_url }
              : {}),
          },
        });

        appLog("info", "system", "scan_complete", `Scan completed for job ${jobId}: ${result.decision?.recommendation ?? 'no decision'}`, { jobId, recommendation: result.decision?.recommendation, confidence: result.decision?.confidence }).catch(() => {});

        // Auto-create or update contact
        try {
          const decision = result.decision;
          if (decision) {
            const events = await prisma.agentEvent.findMany({
              where: { jobId },
              orderBy: { createdAt: "asc" },
            });
            const researchLog = buildResearchLog(events);

            // Each job always creates a fresh Contact — campaigns are fully isolated
            const savedImageUrl = decision.profile_image_url || null;

            // Parse CSV row data for fallback field values
            let csvFields: Record<string, string> = {};
            if (job.csvRowData) {
              try { csvFields = JSON.parse(job.csvRowData); } catch { /* ignore */ }
            }
            // Helper: find a CSV value by checking common column name variations
            const csvVal = (...keys: string[]): string | null => {
              for (const k of keys) {
                for (const [ck, cv] of Object.entries(csvFields)) {
                  if (ck.toLowerCase().replace(/[^a-z]/g, '') === k.toLowerCase().replace(/[^a-z]/g, '') && cv?.trim()) {
                    return cv.trim();
                  }
                }
              }
              return null;
            };

            const contact = await prisma.contact.create({
              data: {
                userId: user.id,
                teamId: user.teamId ?? null,
                linkedinUrl: decision.corrected_linkedin_url || job.linkedinUrl,
                name: personName || "Unknown",
                company: decision.company || csvVal('company', 'companyname', 'employer', 'organization') || null,
                title: decision.job_title || csvVal('title', 'jobtitle', 'role', 'position') || null,
                email: decision.email || csvVal('email', 'emailaddress', 'workemail') || null,
                recommendation: decision.recommendation,
                confidence: decision.confidence,
                homeAddress: decision.home_address?.address || null,
                officeAddress: decision.office_address?.address || null,
                profileImageUrl: savedImageUrl,
                careerSummary: decision.career_summary || null,
                lastScannedAt: new Date(),
                jobId,
                csvRowData: job.csvRowData ?? null,
                notes: researchLog,
              },
            });

            // Post-scan photo fix: if profile image is missing or a placeholder,
            // attempt a lightweight refresh (same logic as /api/contacts/[id]/refresh-photo)
            if (!savedImageUrl || isPlaceholderUrl(savedImageUrl)) {
              try {
                let photoUrl: string | null = null;

                // 1. Bright Data scrape
                const profile = await fetchBrightDataLinkedIn(job.linkedinUrl);
                const avatar = profile ? (profile as Record<string, unknown>).avatar as string | undefined : undefined;
                if (avatar && !isPlaceholderUrl(avatar)) photoUrl = avatar;

                // 2. PDL fallback
                if (!photoUrl) {
                  const pdlResult = await enrichWithPDL(job.linkedinUrl);
                  if (pdlResult.success && pdlResult.data) {
                    const pic = (pdlResult.data as Record<string, unknown>).profile_pic_url as string | undefined;
                    if (pic && !isPlaceholderUrl(pic)) photoUrl = pic;
                  }
                }

                // 3. Exa person search → Bright Data scrape
                if (!photoUrl && personName) {
                  const exaResult = await searchExaPerson(personName, '', 3);
                  if (exaResult.success && Array.isArray(exaResult.data)) {
                    for (const r of exaResult.data as Array<{ url?: string }>) {
                      if (!r.url?.includes('linkedin.com/in/')) continue;
                      if (r.url === job.linkedinUrl) continue;
                      const p = await fetchBrightDataLinkedIn(r.url);
                      const a = p ? (p as Record<string, unknown>).avatar as string | undefined : undefined;
                      if (a && !isPlaceholderUrl(a)) { photoUrl = a; break; }
                    }
                  }
                }

                if (photoUrl) {
                  await prisma.contact.update({
                    where: { id: contact.id },
                    data: { profileImageUrl: photoUrl },
                  });
                }
              } catch {
                // Photo refresh is best-effort — don't fail the scan
              }
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

        if (!isCancelled) {
          appLog("error", "system", "scan_fail", `Scan failed for job ${jobId}: ${message}`, { jobId, error: message }).catch(() => {});
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
    const parts = urlMatch[1].split("-");
    // Remove trailing parts that look like LinkedIn ID suffixes (hex/numeric strings)
    while (parts.length > 1 && /^[0-9a-f]+$/i.test(parts[parts.length - 1])) {
      parts.pop();
    }
    if (parts.length > 0) {
      return parts
        .filter((w) => w.length > 0)
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
