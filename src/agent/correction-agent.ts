/**
 * Correction Agent — conversational agent with tools for correcting
 * scan, enrichment, and postcard results.
 *
 * Unlike the fire-and-forget scan/enrich agents, this is multi-turn:
 * the user sends a message, the agent runs a tool loop (max 10 iterations),
 * then returns a response. The user can continue the conversation.
 *
 * The agent has full access to all stages — it can edit scan, enrichment,
 * and postcard data regardless of which stage the user opened from.
 */

import type { Message, ToolUseBlock, ToolResultBlock, TextBlock } from './types';
import {
  type CorrectionStage,
  type CorrectionContext,
  type CorrectionToolState,
  getCorrectionTools,
  executeCorrectionTool,
} from './correction-tools';
import { getAIClientForRole } from '@/lib/ai/config';
import fs from 'fs';
import path from 'path';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CorrectionInput {
  contactId: string;
  stage: CorrectionStage;
  userMessage: string;
  conversationHistory: Message[];
  contextData: CorrectionContext;
  imageData?: string;
  imageMediaType?: string;
}

export type CorrectionEventType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'response_text'
  | 'preview'
  | 'changes_applied'
  | 'regenerating'
  | 'error';

export interface CorrectionEvent {
  type: CorrectionEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── Config ─────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 10;

// ─── System Prompt ──────────────────────────────────────────────────────────

function loadSystemPrompt(stage: CorrectionStage, context: CorrectionContext): string {
  // Try loading from file first
  let template = '';
  try {
    const filePath = path.join(process.cwd(), 'prompts', 'correction_system.md');
    template = fs.readFileSync(filePath, 'utf-8');
  } catch {
    template = FALLBACK_PROMPT;
  }

  const contextBlock = buildContextBlock(context, stage);
  return template
    .replace(/\{\{stage\}\}/g, stage)
    .replace(/\{\{context_block\}\}/g, contextBlock);
}

/**
 * Build context block with ALL available data, regardless of which stage opened the modal.
 * The "opened from" stage is noted so the agent knows what the user is primarily looking at.
 */
function buildContextBlock(ctx: CorrectionContext, openedFrom: CorrectionStage): string {
  const lines: string[] = [];

  lines.push(`**Opened from:** ${openedFrom} stage`);
  lines.push('');

  // ── Contact / Scan Data ──
  lines.push('### Contact (Scan Data)');
  lines.push(`- **Name:** ${ctx.contact.name ?? 'Unknown'}`);
  if (ctx.contact.company) lines.push(`- **Company:** ${ctx.contact.company}`);
  if (ctx.contact.title) lines.push(`- **Title:** ${ctx.contact.title}`);
  lines.push(`- **LinkedIn:** ${ctx.contact.linkedinUrl}`);
  lines.push(`- **Recommendation:** ${ctx.contact.recommendation ?? 'None'}`);
  lines.push(`- **Confidence:** ${ctx.contact.confidence ?? 'N/A'}%`);
  lines.push(`- **Home Address:** ${ctx.contact.homeAddress ?? 'Not found'}`);
  lines.push(`- **Office Address:** ${ctx.contact.officeAddress ?? 'Not found'}`);
  if (ctx.contact.careerSummary) {
    lines.push(`- **Career Summary:** ${ctx.contact.careerSummary}`);
  }
  if (ctx.contact.profileImageUrl) {
    lines.push(`- **Profile Image:** ${ctx.contact.profileImageUrl}`);
  }

  // ── Enrichment Data ──
  if (ctx.enrichment) {
    const e = ctx.enrichment;
    lines.push('');
    lines.push('### Enrichment Data');
    lines.push(`- **Company Name:** ${e.companyName ?? 'Unknown'}`);
    if (e.companyLogo) lines.push(`- **Company Logo:** ${e.companyLogo}`);
    if (e.openRoles) lines.push(`- **Open Roles:** ${JSON.stringify(e.openRoles)}`);
    if (e.companyValues) lines.push(`- **Company Values:** ${JSON.stringify(e.companyValues)}`);
    if (e.companyMission) lines.push(`- **Mission:** ${e.companyMission}`);
    if (e.officeLocations) lines.push(`- **Office Locations:** ${JSON.stringify(e.officeLocations)}`);
    if (e.teamPhotos) lines.push(`- **Team Photos:** ${JSON.stringify(e.teamPhotos)}`);
  }

  // ── Postcard Data ──
  if (ctx.postcard) {
    const p = ctx.postcard;
    lines.push('');
    lines.push('### Postcard Data');
    lines.push(`- **Template:** ${p.template}`);
    lines.push(`- **Status:** ${p.status}`);
    lines.push(`- **Contact Name:** ${p.contactName}`);
    if (p.contactTitle) lines.push(`- **Contact Title:** ${p.contactTitle}`);
    lines.push(`- **Delivery Address:** ${p.deliveryAddress ?? 'None'}`);
    lines.push(`- **Back Message:** ${p.backMessage ?? 'None'}`);
    if (p.companyLogo) lines.push(`- **Postcard Logo:** ${p.companyLogo}`);
    if (p.contactPhoto) lines.push(`- **Contact Photo:** ${p.contactPhoto}`);
    if (p.imageUrl) lines.push(`- **Current Postcard Image:** ${p.imageUrl}`);
    if (p.openRoles) lines.push(`- **Postcard Open Roles:** ${JSON.stringify(p.openRoles)}`);
    if (p.teamPhotos) lines.push(`- **Postcard Team Photos:** ${JSON.stringify(p.teamPhotos)}`);
  }

  // ── Reference Images ──
  if (ctx.referenceImages?.length) {
    lines.push('');
    lines.push('### User-Uploaded Reference Images');
    for (const ref of ctx.referenceImages) {
      lines.push(`- **${ref.label}:** ${ref.imageUrl}`);
    }
  }

  return lines.join('\n');
}

const FALLBACK_PROMPT = `# Correction Agent

You are a correction specialist for WDISTT (Where Do I Send This Thing), a recruitment outreach platform that generates personalised physical postcards.

You have full access to correct ANY data at ANY stage — scan, enrichment, or postcard. Use preview_changes with a "target" parameter ("scan", "enrich", or "postcard") to specify which record to update.

## Workflow
1. View the current data, understand what the user wants to fix.
2. Research using your tools if needed.
3. Preview changes — ALWAYS show before/after before applying.
4. Apply only after user confirms.
5. Regenerate postcard if visual fields changed.

## Rules
- NEVER apply without preview + confirmation.
- NEVER fabricate data.
- Be concise. Show images inline with markdown.
- Don't reveal tool names to the user.

## Current State
{{context_block}}`;

// ─── Agent Loop ─────────────────────────────────────────────────────────────

export async function runCorrectionAgent(
  input: CorrectionInput,
  onEvent: (event: CorrectionEvent) => void,
): Promise<string> {
  const { stage, contextData, conversationHistory } = input;

  const systemPrompt = loadSystemPrompt(stage, contextData);
  const tools = getCorrectionTools(stage);

  // Build messages: system goes first in the API call, then conversation + new user message
  const messages: Message[] = [...conversationHistory];

  // Add the new user message
  if (input.imageData && input.imageMediaType) {
    messages.push({
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: input.imageMediaType,
            data: input.imageData,
          },
        } as unknown as TextBlock,
        { type: 'text', text: input.userMessage },
      ],
    });
  } else {
    messages.push({ role: 'user', content: input.userMessage });
  }

  let client = await getAIClientForRole('agent');
  const toolState: CorrectionToolState = {
    pendingChanges: null,
    pendingTarget: null,
    pendingExplanation: null,
    applied: false,
  };

  let finalText = '';

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let response;
    try {
      response = await client.callModel(messages, tools, { maxTokens: 8192, temperature: 0.3, system: systemPrompt });
    } catch (err) {
      const errMsg = (err as Error).message || '';
      // Rate limit fallback
      if (errMsg.includes('ThrottlingException') || errMsg.includes('rate limit') || errMsg.includes('Too many tokens')) {
        try {
          client = await getAIClientForRole('fallback');
          response = await client.callModel(messages, tools, { maxTokens: 8192, temperature: 0.3, system: systemPrompt });
        } catch (fallbackErr) {
          onEvent({ type: 'error', timestamp: ts(), data: { message: (fallbackErr as Error).message } });
          return 'I encountered an error. Please try again.';
        }
      } else {
        onEvent({ type: 'error', timestamp: ts(), data: { message: errMsg } });
        return 'I encountered an error. Please try again.';
      }
    }

    // Process response content blocks
    const assistantContent = response.content;
    const toolUses: ToolUseBlock[] = [];
    const textParts: string[] = [];

    for (const block of assistantContent) {
      if (block.type === 'text') {
        textParts.push((block as TextBlock).text);
      } else if (block.type === 'tool_use') {
        toolUses.push(block as ToolUseBlock);
      }
    }

    // Emit any thinking/text
    if (textParts.length > 0) {
      const text = textParts.join('\n');
      onEvent({ type: 'response_text', timestamp: ts(), data: { text } });
      finalText = text;
    }

    // Add assistant message to conversation
    messages.push({ role: 'assistant', content: assistantContent });

    // If no tool calls, we're done
    if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
      break;
    }

    // Execute tool calls
    const toolResults: ToolResultBlock[] = [];

    for (const toolUse of toolUses) {
      onEvent({
        type: 'tool_call',
        timestamp: ts(),
        data: { tool: toolUse.name, input: toolUse.input },
      });

      const { result, stateUpdate } = await executeCorrectionTool(
        toolUse.name,
        toolUse.input,
        contextData,
        stage,
        toolState,
      );

      // Apply state updates
      if (stateUpdate) {
        if ('pendingChanges' in stateUpdate) toolState.pendingChanges = stateUpdate.pendingChanges ?? null;
        if ('pendingTarget' in stateUpdate) toolState.pendingTarget = stateUpdate.pendingTarget ?? null;
        if ('pendingExplanation' in stateUpdate) toolState.pendingExplanation = stateUpdate.pendingExplanation ?? null;
        if ('applied' in stateUpdate) toolState.applied = stateUpdate.applied ?? false;
      }

      onEvent({
        type: 'tool_result',
        timestamp: ts(),
        data: { tool: toolUse.name, success: result.success, summary: result.summary },
      });

      // Emit special events for preview, apply, and regenerate
      if (toolUse.name === 'preview_changes' && result.success) {
        onEvent({
          type: 'preview',
          timestamp: ts(),
          data: {
            changes: (result.data as Record<string, unknown>)?.changes ?? {},
            explanation: (result.data as Record<string, unknown>)?.explanation ?? '',
            markdown: (result.data as Record<string, unknown>)?.markdown ?? '',
          },
        });
      }

      if (toolUse.name === 'apply_changes' && result.success) {
        onEvent({
          type: 'changes_applied',
          timestamp: ts(),
          data: { success: true, updatedFields: (result.data as Record<string, unknown>)?.updatedFields ?? [], target: (result.data as Record<string, unknown>)?.target ?? '' },
        });
      }

      if (toolUse.name === 'regenerate_postcard' && result.success) {
        onEvent({
          type: 'regenerating',
          timestamp: ts(),
          data: { postcardId: (result.data as Record<string, unknown>)?.postcardId ?? '' },
        });
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify({ success: result.success, summary: result.summary, data: result.data }),
      });
    }

    // Add tool results to conversation
    messages.push({ role: 'user', content: toolResults });
  }

  return finalText;
}

function ts(): string {
  return new Date().toISOString();
}
