/**
 * Correction Agent — Tool definitions and dispatch.
 *
 * All tools are available regardless of which stage the user opened from.
 * The agent can freely edit scan, enrichment, and postcard data.
 */

import type { ToolDefinition, ToolResult } from './types';
import {
  searchPersonAddress,
  searchExaAI,
  getPropertyDetails,
  calculateDistance,
  fetchCompanyLogo,
  fetchBrandfetch,
  fetchLogoDev,
  fetchBrightDataLinkedIn,
  scrapeWithFirecrawl,
} from './services';
import axios from 'axios';
import { prisma } from '@/lib/db';

// ─── Context Types ──────────────────────────────────────────────────────────

export type CorrectionStage = 'scan' | 'enrich' | 'postcard';

export interface CorrectionContext {
  contactId: string;
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    company: string | null;
    title: string | null;
    homeAddress: string | null;
    officeAddress: string | null;
    recommendation: string | null;
    confidence: number | null;
    careerSummary: string | null;
    linkedinUrl: string;
    profileImageUrl: string | null;
  };
  // Scan
  jobId?: string;
  jobResult?: Record<string, unknown> | null;
  researchLog?: string;
  // Enrich
  enrichmentId?: string;
  enrichment?: {
    id: string;
    companyName: string | null;
    companyLogo: string | null;
    openRoles: unknown;
    companyValues: unknown;
    companyMission: string | null;
    officeLocations: unknown;
    teamPhotos: unknown;
  } | null;
  // Postcard
  postcardId?: string;
  postcard?: {
    id: string;
    template: string;
    status: string;
    backMessage: string | null;
    companyLogo: string | null;
    openRoles: unknown;
    companyValues: unknown;
    companyMission: string | null;
    contactName: string;
    contactTitle: string | null;
    contactPhoto: string | null;
    teamPhotos: unknown;
    deliveryAddress: string | null;
    imageUrl: string | null;
  } | null;
  // Reference images
  referenceImages?: Array<{ id: string; label: string; imageUrl: string }>;
}

// ─── Tool Definitions ──────────────────────────────────────────────────────

const ALL_TOOLS: ToolDefinition[] = [
  // ── Common ──
  {
    name: 'view_current_record',
    description:
      'View ALL current data for this contact across all stages — scan results, enrichment data, and postcard data. Returns everything we have.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'preview_changes',
    description:
      'Generate a preview of proposed changes. Shows current vs proposed values. You MUST call this before apply_changes so the user can review. Specify which record to update: "scan" (contact fields), "enrich" (enrichment fields), or "postcard" (postcard fields).',
    input_schema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['scan', 'enrich', 'postcard'],
          description: 'Which record to update: "scan" for contact fields, "enrich" for enrichment, "postcard" for postcard.',
        },
        changes: {
          type: 'object',
          description: 'Object mapping field names to their new values. Only include fields that are changing.',
        },
        explanation: {
          type: 'string',
          description: 'Brief explanation of why these changes are correct.',
        },
      },
      required: ['target', 'changes', 'explanation'],
    },
  },
  {
    name: 'apply_changes',
    description:
      'Apply the previously previewed changes to the database. Only call this AFTER the user has explicitly approved the preview.',
    input_schema: {
      type: 'object',
      properties: {
        confirmed: {
          type: 'boolean',
          description: 'Must be true. Set to false if the user rejected the changes.',
        },
      },
      required: ['confirmed'],
    },
  },
  {
    name: 'regenerate_postcard',
    description:
      'Trigger regeneration of the postcard image using the current data. Use this after updating visual fields (logo, photo, roles) or when the user says the generated image looks wrong. The postcard will be queued for regeneration and a new image will be created.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  // ── Research Tools ──
  {
    name: 'search_person_address',
    description:
      'Search for residential address history by person name. Returns current addresses, owned properties, phone numbers.',
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'First name' },
        middle_name: { type: 'string', description: 'Middle name (optional)' },
        last_name: { type: 'string', description: 'Last name' },
        city: { type: 'string', description: 'City (optional)' },
        state: { type: 'string', description: 'Two-letter US state code (optional)' },
        phone: { type: 'string', description: 'Phone number (optional)' },
      },
      required: ['first_name', 'last_name'],
    },
  },
  {
    name: 'verify_property',
    description:
      'Verify property ownership at a US street address. Check if a specific person owns the property.',
    input_schema: {
      type: 'object',
      properties: {
        street_address: { type: 'string', description: 'Full street address' },
        city: { type: 'string', description: 'City name' },
        state: { type: 'string', description: 'Two-letter state code' },
        order_id: { type: 'string', description: 'Unique ID (use firstname-lastname-timestamp)' },
      },
      required: ['street_address', 'city', 'state', 'order_id'],
    },
  },
  {
    name: 'calculate_distance',
    description:
      'Calculate driving distance and travel time between two addresses.',
    input_schema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Starting address' },
        destination: { type: 'string', description: 'Destination address' },
      },
      required: ['origin', 'destination'],
    },
  },
  {
    name: 'search_web',
    description: 'Search the web for information about a person, company, address, or anything else.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        num_results: { type: 'number', description: 'Number of results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_company_logo',
    description:
      'Fetch company logo by domain. Tries multiple logo services.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Company domain (e.g. "stripe.com")' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch and read the contents of a URL. Use for careers pages, about pages, etc.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
  },
  {
    name: 'scrape_linkedin_profile',
    description:
      "Scrape a LinkedIn profile to get the person's headshot, name, and title.",
    input_schema: {
      type: 'object',
      properties: {
        linkedin_url: { type: 'string', description: 'LinkedIn profile URL' },
      },
      required: ['linkedin_url'],
    },
  },
];

// ─── Public API ─────────────────────────────────────────────────────────

export function getCorrectionTools(_stage: CorrectionStage): ToolDefinition[] {
  return ALL_TOOLS;
}

// ─── Tool Execution ─────────────────────────────────────────────────────────

export interface CorrectionToolState {
  pendingChanges: Record<string, unknown> | null;
  pendingTarget: CorrectionStage | null;
  pendingExplanation: string | null;
  applied: boolean;
}

export async function executeCorrectionTool(
  toolName: string,
  args: Record<string, unknown>,
  context: CorrectionContext,
  _stage: CorrectionStage,
  state: CorrectionToolState,
): Promise<{ result: ToolResult; stateUpdate?: Partial<CorrectionToolState> }> {
  switch (toolName) {
    // ── Common ────────────────────────────────────────────

    case 'view_current_record':
      return { result: viewCurrentRecord(context) };

    case 'preview_changes':
      return previewChanges(args, context);

    case 'apply_changes':
      return applyChanges(args, context, state);

    case 'regenerate_postcard':
      return regeneratePostcard(context);

    // ── Research Tools ──────────────────────────────────────

    case 'search_person_address':
      return {
        result: await searchPersonAddress(
          args.first_name as string,
          args.last_name as string,
          args.middle_name as string | undefined,
          args.city as string | undefined,
          args.state as string | undefined,
          args.phone as string | undefined,
        ),
      };

    case 'verify_property':
      return {
        result: await getPropertyDetails(
          args.street_address as string,
          args.city as string,
          args.state as string,
          args.order_id as string,
        ),
      };

    case 'calculate_distance':
      return {
        result: await calculateDistance(
          args.origin as string,
          args.destination as string,
        ),
      };

    case 'search_web':
      return {
        result: await searchExaAI(
          args.query as string,
          'auto',
          (args.num_results as number | undefined) ?? 5,
        ),
      };

    case 'fetch_company_logo': {
      const domain = args.domain as string;
      let result = await fetchCompanyLogo(domain);
      if (!result.success) result = await fetchBrandfetch(domain);
      if (!result.success) result = await fetchLogoDev(domain);
      return { result };
    }

    case 'fetch_url': {
      const scraped = await scrapeWithFirecrawl(args.url as string);
      return {
        result: {
          success: scraped.success,
          data: { text: scraped.content },
          summary: scraped.success ? `Fetched ${(args.url as string).slice(0, 80)}` : `Failed to fetch URL: ${scraped.error}`,
        },
      };
    }

    case 'scrape_linkedin_profile': {
      const profileResult = await fetchBrightDataLinkedIn(args.linkedin_url as string);
      if (!profileResult) {
        return { result: { success: false, summary: "No LinkedIn profile data found" } };
      }
      return { result: { success: true, summary: `Found profile: ${profileResult.fullName ?? "Unknown"}`, data: profileResult } };
    }

    // ── Unknown ───────────────────────────────────────────

    default:
      return { result: { success: false, summary: `Unknown tool: ${toolName}` } };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function viewCurrentRecord(ctx: CorrectionContext): ToolResult {
  const data: Record<string, unknown> = {
    scan: {
      name: ctx.contact.name,
      email: ctx.contact.email,
      company: ctx.contact.company,
      title: ctx.contact.title,
      homeAddress: ctx.contact.homeAddress,
      officeAddress: ctx.contact.officeAddress,
      recommendation: ctx.contact.recommendation,
      confidence: ctx.contact.confidence,
      careerSummary: ctx.contact.careerSummary,
      linkedinUrl: ctx.contact.linkedinUrl,
      profileImageUrl: ctx.contact.profileImageUrl,
    },
  };

  if (ctx.enrichment) {
    data.enrichment = {
      companyName: ctx.enrichment.companyName,
      companyLogo: ctx.enrichment.companyLogo,
      openRoles: ctx.enrichment.openRoles,
      companyValues: ctx.enrichment.companyValues,
      companyMission: ctx.enrichment.companyMission,
      officeLocations: ctx.enrichment.officeLocations,
      teamPhotos: ctx.enrichment.teamPhotos,
    };
  }

  if (ctx.postcard) {
    data.postcard = {
      template: ctx.postcard.template,
      status: ctx.postcard.status,
      backMessage: ctx.postcard.backMessage,
      contactName: ctx.postcard.contactName,
      contactTitle: ctx.postcard.contactTitle,
      deliveryAddress: ctx.postcard.deliveryAddress,
      companyLogo: ctx.postcard.companyLogo,
      contactPhoto: ctx.postcard.contactPhoto,
      teamPhotos: ctx.postcard.teamPhotos,
      openRoles: ctx.postcard.openRoles,
      imageUrl: ctx.postcard.imageUrl,
    };
  }

  if (ctx.referenceImages?.length) {
    data.referenceImages = ctx.referenceImages;
  }

  return {
    success: true,
    summary: 'Current data across all stages',
    data,
  };
}

function previewChanges(
  args: Record<string, unknown>,
  ctx: CorrectionContext,
): { result: ToolResult; stateUpdate: Partial<CorrectionToolState> } {
  const target = (args.target as CorrectionStage) ?? 'scan';
  const changes = args.changes as Record<string, unknown>;
  const explanation = args.explanation as string;

  // Build a markdown diff
  const currentData = getCurrentData(ctx, target);
  const rows = Object.entries(changes).map(([field, newVal]) => {
    const oldVal = currentData[field] ?? '(empty)';
    const displayOld = typeof oldVal === 'object' ? JSON.stringify(oldVal, null, 1) : String(oldVal);
    const displayNew = typeof newVal === 'object' ? JSON.stringify(newVal, null, 1) : String(newVal);
    return `| ${field} | ${displayOld} | ${displayNew} |`;
  });

  const markdown = [
    `## Proposed Changes (${target})\n`,
    '| Field | Current Value | New Value |',
    '|-------|---------------|-----------|',
    ...rows,
    '',
    `**Reason:** ${explanation}`,
  ].join('\n');

  return {
    result: {
      success: true,
      summary: markdown,
      data: { changes, explanation, markdown, target },
    },
    stateUpdate: {
      pendingChanges: changes,
      pendingTarget: target,
      pendingExplanation: explanation,
    },
  };
}

async function applyChanges(
  args: Record<string, unknown>,
  ctx: CorrectionContext,
  state: CorrectionToolState,
): Promise<{ result: ToolResult; stateUpdate: Partial<CorrectionToolState> }> {
  if (!state.pendingChanges || !state.pendingTarget) {
    return {
      result: { success: false, summary: 'No preview generated yet. Call preview_changes first.' },
      stateUpdate: {},
    };
  }

  if (args.confirmed !== true) {
    return {
      result: { success: false, summary: 'User did not confirm. Changes NOT applied.' },
      stateUpdate: { pendingChanges: null, pendingTarget: null, pendingExplanation: null },
    };
  }

  const changes = state.pendingChanges;
  const target = state.pendingTarget;

  try {
    if (target === 'scan') {
      await applyScanChanges(ctx, changes);
    } else if (target === 'enrich') {
      await applyEnrichChanges(ctx, changes);
    } else if (target === 'postcard') {
      await applyPostcardChanges(ctx, changes);
    }

    return {
      result: {
        success: true,
        summary: `Changes applied successfully to ${target} record. Updated fields: ${Object.keys(changes).join(', ')}`,
        data: { updatedFields: Object.keys(changes), target },
      },
      stateUpdate: { applied: true, pendingChanges: null, pendingTarget: null, pendingExplanation: null },
    };
  } catch (e) {
    return {
      result: { success: false, summary: `Failed to apply changes: ${(e as Error).message}` },
      stateUpdate: {},
    };
  }
}

async function regeneratePostcard(ctx: CorrectionContext): Promise<{ result: ToolResult; stateUpdate?: Partial<CorrectionToolState> }> {
  if (!ctx.postcardId) {
    return { result: { success: false, summary: 'No postcard found to regenerate.' } };
  }

  // Reset the postcard to pending so the generation pipeline picks it up
  await prisma.postcard.update({
    where: { id: ctx.postcardId },
    data: {
      status: 'pending',
      imageUrl: null,
      backgroundUrl: null,
      errorMessage: null,
      retryCount: 0,
    },
  });

  return {
    result: {
      success: true,
      summary: 'Postcard has been queued for regeneration. The new image will be generated with the current data.',
      data: { postcardId: ctx.postcardId, status: 'pending' },
    },
  };
}

async function applyScanChanges(ctx: CorrectionContext, changes: Record<string, unknown>) {
  // Create a ContactRevision snapshot before modifying
  const currentContact = await prisma.contact.findUnique({
    where: { id: ctx.contactId },
    include: { job: { select: { result: true } } },
  });

  if (currentContact) {
    const maxRev = await prisma.contactRevision.aggregate({
      where: { contactId: ctx.contactId },
      _max: { revisionNumber: true },
    });
    const nextRev = (maxRev._max.revisionNumber ?? 0) + 1;

    // Mark old revisions as not latest
    await prisma.contactRevision.updateMany({
      where: { contactId: ctx.contactId, isLatest: true },
      data: { isLatest: false },
    });

    await prisma.contactRevision.create({
      data: {
        contactId: ctx.contactId,
        revisionNumber: nextRev,
        isLatest: true,
        name: currentContact.name,
        email: currentContact.email,
        linkedinUrl: currentContact.linkedinUrl,
        company: currentContact.company,
        title: currentContact.title,
        profileImageUrl: currentContact.profileImageUrl,
        careerSummary: currentContact.careerSummary,
        homeAddress: currentContact.homeAddress,
        officeAddress: currentContact.officeAddress,
        recommendation: currentContact.recommendation,
        confidence: currentContact.confidence,
        jobResult: currentContact.job?.result ?? null,
      },
    });
  }

  // Apply contact changes
  const contactFields = ['name', 'email', 'company', 'title', 'homeAddress', 'officeAddress', 'recommendation', 'confidence', 'careerSummary'];
  const contactData: Record<string, unknown> = {};
  for (const f of contactFields) {
    if (f in changes) contactData[f] = changes[f];
  }
  if (Object.keys(contactData).length > 0) {
    await prisma.contact.update({ where: { id: ctx.contactId }, data: contactData });
  }

  // Sync recommendation/confidence to Job if changed
  if (ctx.jobId && ('recommendation' in changes || 'confidence' in changes)) {
    const jobData: Record<string, unknown> = {};
    if ('recommendation' in changes) jobData.recommendation = changes.recommendation;
    if ('confidence' in changes) jobData.confidence = changes.confidence;
    await prisma.job.update({ where: { id: ctx.jobId }, data: jobData });
  }
}

async function applyEnrichChanges(ctx: CorrectionContext, changes: Record<string, unknown>) {
  if (!ctx.enrichmentId) throw new Error('No enrichment record to update');

  await prisma.companyEnrichment.update({
    where: { id: ctx.enrichmentId },
    data: changes,
  });
}

async function applyPostcardChanges(ctx: CorrectionContext, changes: Record<string, unknown>) {
  if (!ctx.postcardId) throw new Error('No postcard record to update');

  // Fields that affect the generated postcard image — changing these triggers regeneration
  const visualFields = ['contactPhoto', 'teamPhotos', 'companyLogo', 'openRoles'];
  const visualChanged = visualFields.some((f) => f in changes);

  const data: Record<string, unknown> = { ...changes };
  if (visualChanged) {
    data.imageUrl = null;
    data.backgroundUrl = null;
    data.status = 'pending';
  }

  await prisma.postcard.update({ where: { id: ctx.postcardId }, data });
}

function getCurrentData(ctx: CorrectionContext, target: CorrectionStage): Record<string, unknown> {
  if (target === 'scan') {
    return {
      name: ctx.contact.name,
      email: ctx.contact.email,
      company: ctx.contact.company,
      title: ctx.contact.title,
      homeAddress: ctx.contact.homeAddress,
      officeAddress: ctx.contact.officeAddress,
      recommendation: ctx.contact.recommendation,
      confidence: ctx.contact.confidence,
      careerSummary: ctx.contact.careerSummary,
    };
  }
  if (target === 'enrich' && ctx.enrichment) {
    return {
      companyName: ctx.enrichment.companyName,
      companyLogo: ctx.enrichment.companyLogo,
      openRoles: ctx.enrichment.openRoles,
      companyValues: ctx.enrichment.companyValues,
      companyMission: ctx.enrichment.companyMission,
      officeLocations: ctx.enrichment.officeLocations,
      teamPhotos: ctx.enrichment.teamPhotos,
    };
  }
  if (target === 'postcard' && ctx.postcard) {
    return {
      template: ctx.postcard.template,
      backMessage: ctx.postcard.backMessage,
      contactName: ctx.postcard.contactName,
      contactTitle: ctx.postcard.contactTitle,
      deliveryAddress: ctx.postcard.deliveryAddress,
      companyLogo: ctx.postcard.companyLogo,
      contactPhoto: ctx.postcard.contactPhoto,
      teamPhotos: ctx.postcard.teamPhotos,
      openRoles: ctx.postcard.openRoles,
    };
  }
  return {};
}
