/**
 * Correction Agent — SSE streaming chat endpoint.
 *
 * POST /api/corrections/chat
 * Body: { contactId, stage, message, history[], imageData?, imageMediaType? }
 * Response: text/event-stream with CorrectionEvent payloads
 *
 * Always loads ALL context (scan + enrich + postcard) regardless of stage,
 * so the agent can freely edit any field.
 */

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTeamUserIds } from '@/lib/team';
import { runCorrectionAgent } from '@/agent/correction-agent';
import type { CorrectionInput, CorrectionEvent } from '@/agent/correction-agent';
import type { CorrectionContext, CorrectionStage } from '@/agent/correction-tools';
import type { Message } from '@/agent/types';

export const maxDuration = 300; // 5 minutes

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return new Response('Not authenticated', { status: 401 });
  }

  let body: {
    contactId: string;
    stage: CorrectionStage;
    message: string;
    history: Message[];
    imageData?: string;
    imageMediaType?: string;
  };

  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { contactId, stage, message, history, imageData, imageMediaType } = body;

  if (!contactId || !stage || !message) {
    return new Response('Missing required fields: contactId, stage, message', { status: 400 });
  }

  if (!['scan', 'enrich', 'postcard'].includes(stage)) {
    return new Response('Invalid stage', { status: 400 });
  }

  const teamUserIds = await getTeamUserIds(user);

  // Always load ALL relations — agent can edit any stage
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, userId: { in: teamUserIds } },
    include: {
      job: {
        select: {
          id: true,
          result: true,
          recommendation: true,
          confidence: true,
          events: {
            orderBy: { createdAt: 'asc' as const },
            select: { type: true, data: true, iteration: true },
          },
        },
      },
      companyEnrichments: {
        where: { isLatest: true },
        take: 1,
      },
      postcards: {
        where: { status: { notIn: ["cancelled", "failed"] } },
        orderBy: { updatedAt: 'desc' as const },
        take: 1,
        include: { references: true },
      },
    },
  });

  if (!contact) {
    return new Response('Contact not found', { status: 404 });
  }

  // Build full CorrectionContext — always includes everything available
  const context: CorrectionContext = {
    contactId: contact.id,
    contact: {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      company: contact.company,
      title: contact.title,
      homeAddress: contact.homeAddress,
      officeAddress: contact.officeAddress,
      recommendation: contact.recommendation,
      confidence: contact.confidence,
      careerSummary: contact.careerSummary,
      linkedinUrl: contact.linkedinUrl,
      profileImageUrl: contact.profileImageUrl,
    },
  };

  // Scan context
  if (contact.job) {
    const job = contact.job as typeof contact.job & {
      events?: Array<{ type: string; data: string; iteration: number | null }>;
    };
    context.jobId = job.id;
    context.jobResult = job.result ? JSON.parse(job.result) : null;

    if (job.events?.length) {
      context.researchLog = buildResearchLogFromEvents(job.events);
    }
  }

  // Enrich context
  const enrichment = (contact.companyEnrichments as Array<{
    id: string;
    companyName: string;
    companyLogo: string | null;
    openRoles: unknown;
    companyValues: unknown;
    companyMission: string | null;
    officeLocations: unknown;
    teamPhotos: unknown;
  }>)?.[0];
  if (enrichment) {
    context.enrichmentId = enrichment.id;
    context.enrichment = {
      id: enrichment.id,
      companyName: enrichment.companyName,
      companyLogo: enrichment.companyLogo,
      openRoles: enrichment.openRoles,
      companyValues: enrichment.companyValues,
      companyMission: enrichment.companyMission,
      officeLocations: enrichment.officeLocations,
      teamPhotos: enrichment.teamPhotos,
    };
  }

  // Postcard context — reads live data from contact + enrichment (single source of truth)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postcard = ((contact.postcards as any) as Array<{
    id: string;
    template: string;
    status: string;
    backMessage: string | null;
    contactName: string;
    deliveryAddress: string | null;
    imageUrl: string | null;
    references: Array<{ id: string; label: string; imageUrl: string }>;
  }>)?.[0];
  if (postcard) {
    context.postcardId = postcard.id;
    context.postcard = {
      id: postcard.id,
      template: postcard.template,
      status: postcard.status,
      backMessage: postcard.backMessage,
      contactName: postcard.contactName,
      deliveryAddress: postcard.deliveryAddress,
      imageUrl: postcard.imageUrl,
    };
    context.referenceImages = postcard.references?.map((r) => ({
      id: r.id,
      label: r.label,
      imageUrl: r.imageUrl,
    }));
  }

  // Build agent input
  const input: CorrectionInput = {
    contactId: contact.id,
    stage,
    userMessage: message,
    conversationHistory: history ?? [],
    contextData: context,
    imageData,
    imageMediaType,
  };

  // SSE streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: CorrectionEvent) => {
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        const finalText = await runCorrectionAgent(input, send);

        // Send final done event
        send({
          type: 'response_text',
          timestamp: new Date().toISOString(),
          data: { text: finalText, done: true },
        });
      } catch (err) {
        send({
          type: 'error',
          timestamp: new Date().toISOString(),
          data: { message: (err as Error).message },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildResearchLogFromEvents(
  events: Array<{ type: string; data: string; iteration: number | null }>,
): string {
  const lines: string[] = [];

  for (const event of events) {
    try {
      const data = JSON.parse(event.data);

      switch (event.type) {
        case 'thinking':
          lines.push(`[Agent Reasoning]\n${data.text}\n`);
          break;
        case 'tool_call_start':
          lines.push(`[Tool Call: ${data.toolName}]\nInput: ${JSON.stringify(data.toolInput, null, 2)}\n`);
          break;
        case 'tool_call_result':
          lines.push(`[Tool Result: ${data.toolName}] ${data.success ? 'Success' : 'Failed'}\nSummary: ${data.summary}\n${data.data ? `Data: ${JSON.stringify(data.data, null, 2)}\n` : ''}`);
          break;
        case 'decision_accepted':
          lines.push(`[Decision Accepted]\n${JSON.stringify(data.decision, null, 2)}\n`);
          break;
        case 'decision_rejected':
          lines.push(`[Decision Rejected] Confidence ${data.confidence}% below ${data.threshold}% threshold\n`);
          break;
        case 'error':
          lines.push(`[Error] ${data.message}\n`);
          break;
      }
    } catch {
      // Skip unparseable events
    }
  }

  return lines.join('\n');
}
