/**
 * Correction Agent — Tool definitions and dispatch.
 *
 * Three tool sets (scan / enrich / postcard) plus common tools
 * (view_current_record, preview_changes, apply_changes).
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
    postcardHeadline: string | null;
    postcardDescription: string | null;
    accentColor: string | null;
    backMessage: string | null;
    backgroundPrompt: string | null;
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
    backgroundUrl: string | null;
  } | null;
  // Reference images (postcard stage)
  referenceImages?: Array<{ id: string; label: string; imageUrl: string }>;
}

// ─── Common Tools ───────────────────────────────────────────────────────────

const VIEW_CURRENT_RECORD: ToolDefinition = {
  name: 'view_current_record',
  description:
    'View the current data stored for this contact at the stage being corrected. Returns all relevant fields.',
  input_schema: { type: 'object', properties: {}, required: [] },
};

const PREVIEW_CHANGES: ToolDefinition = {
  name: 'preview_changes',
  description:
    'Generate a preview of proposed changes. Shows current vs proposed values. You MUST call this before apply_changes so the user can review.',
  input_schema: {
    type: 'object',
    properties: {
      changes: {
        type: 'object',
        description:
          'Object mapping field names to their new values. Only include fields that are changing.',
      },
      explanation: {
        type: 'string',
        description: 'Brief explanation of why these changes are correct.',
      },
    },
    required: ['changes', 'explanation'],
  },
};

const APPLY_CHANGES: ToolDefinition = {
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
};

// ─── Scan Tools ─────────────────────────────────────────────────────────────

const SCAN_TOOLS: ToolDefinition[] = [
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
    description: 'Search the web for information about a person, company, or address.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        num_results: { type: 'number', description: 'Number of results (default: 5)' },
      },
      required: ['query'],
    },
  },
];

// ─── Enrich Tools ───────────────────────────────────────────────────────────

const ENRICH_TOOLS: ToolDefinition[] = [
  {
    name: 'fetch_company_logo',
    description:
      'Fetch company logo by domain. Tries Hunter.io, then Brandfetch, then Logo.dev.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Company domain (e.g. "stripe.com")' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'search_web',
    description: 'Search the web for company information, roles, values, etc.',
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

// ─── Postcard Tools ─────────────────────────────────────────────────────────

const POSTCARD_TOOLS: ToolDefinition[] = [
  {
    name: 'search_web',
    description: 'Search the web for reference material.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        num_results: { type: 'number', description: 'Number of results (default: 5)' },
      },
      required: ['query'],
    },
  },
];

// ─── Public API ─────────────────────────────────────────────────────────────

export function getCorrectionTools(stage: CorrectionStage): ToolDefinition[] {
  const stageTools =
    stage === 'scan' ? SCAN_TOOLS :
    stage === 'enrich' ? ENRICH_TOOLS :
    POSTCARD_TOOLS;

  return [...stageTools, VIEW_CURRENT_RECORD, PREVIEW_CHANGES, APPLY_CHANGES];
}

// ─── Tool Execution ─────────────────────────────────────────────────────────

export interface CorrectionToolState {
  pendingChanges: Record<string, unknown> | null;
  pendingExplanation: string | null;
  applied: boolean;
}

export async function executeCorrectionTool(
  toolName: string,
  args: Record<string, unknown>,
  context: CorrectionContext,
  stage: CorrectionStage,
  state: CorrectionToolState,
): Promise<{ result: ToolResult; stateUpdate?: Partial<CorrectionToolState> }> {
  switch (toolName) {
    // ── Common ────────────────────────────────────────────

    case 'view_current_record':
      return { result: viewCurrentRecord(context, stage) };

    case 'preview_changes':
      return previewChanges(args, context, stage);

    case 'apply_changes':
      return applyChanges(args, context, stage, state);

    // ── Scan ──────────────────────────────────────────────

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

    // ── Enrich ────────────────────────────────────────────

    case 'fetch_company_logo': {
      const domain = args.domain as string;
      let result = await fetchCompanyLogo(domain);
      if (!result.success) result = await fetchBrandfetch(domain);
      if (!result.success) result = await fetchLogoDev(domain);
      return { result };
    }

    case 'fetch_url': {
      try {
        const res = await axios.get(args.url as string, {
          timeout: 15000,
          maxRedirects: 3,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; postcard-bot/1.0)' },
        });
        const text = typeof res.data === 'string'
          ? res.data.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000)
          : JSON.stringify(res.data).slice(0, 8000);
        return {
          result: { success: true, data: { text }, summary: `Fetched ${(args.url as string).slice(0, 80)}` },
        };
      } catch (e) {
        return {
          result: { success: false, summary: `Failed to fetch URL: ${(e as Error).message}` },
        };
      }
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

function viewCurrentRecord(ctx: CorrectionContext, stage: CorrectionStage): ToolResult {
  if (stage === 'scan') {
    return {
      success: true,
      summary: 'Current scan record',
      data: {
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
      },
    };
  }

  if (stage === 'enrich' && ctx.enrichment) {
    return {
      success: true,
      summary: 'Current enrichment record',
      data: {
        companyName: ctx.enrichment.companyName,
        companyLogo: ctx.enrichment.companyLogo,
        openRoles: ctx.enrichment.openRoles,
        companyValues: ctx.enrichment.companyValues,
        companyMission: ctx.enrichment.companyMission,
        officeLocations: ctx.enrichment.officeLocations,
        teamPhotos: ctx.enrichment.teamPhotos,
      },
    };
  }

  if (stage === 'postcard' && ctx.postcard) {
    return {
      success: true,
      summary: 'Current postcard record',
      data: {
        template: ctx.postcard.template,
        status: ctx.postcard.status,
        postcardHeadline: ctx.postcard.postcardHeadline,
        postcardDescription: ctx.postcard.postcardDescription,
        accentColor: ctx.postcard.accentColor,
        backMessage: ctx.postcard.backMessage,
        contactName: ctx.postcard.contactName,
        contactTitle: ctx.postcard.contactTitle,
        deliveryAddress: ctx.postcard.deliveryAddress,
        companyLogo: ctx.postcard.companyLogo,
        openRoles: ctx.postcard.openRoles,
        teamPhotos: ctx.postcard.teamPhotos,
        imageUrl: ctx.postcard.imageUrl,
        referenceImages: ctx.referenceImages ?? [],
      },
    };
  }

  return { success: false, summary: 'No record found for this stage' };
}

function previewChanges(
  args: Record<string, unknown>,
  ctx: CorrectionContext,
  stage: CorrectionStage,
): { result: ToolResult; stateUpdate: Partial<CorrectionToolState> } {
  const changes = args.changes as Record<string, unknown>;
  const explanation = args.explanation as string;

  // Build a markdown diff
  const currentData = getCurrentData(ctx, stage);
  const rows = Object.entries(changes).map(([field, newVal]) => {
    const oldVal = currentData[field] ?? '(empty)';
    const displayOld = typeof oldVal === 'object' ? JSON.stringify(oldVal, null, 1) : String(oldVal);
    const displayNew = typeof newVal === 'object' ? JSON.stringify(newVal, null, 1) : String(newVal);
    return `| ${field} | ${displayOld} | ${displayNew} |`;
  });

  const markdown = [
    '## Proposed Changes\n',
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
      data: { changes, explanation, markdown },
    },
    stateUpdate: {
      pendingChanges: changes,
      pendingExplanation: explanation,
    },
  };
}

async function applyChanges(
  args: Record<string, unknown>,
  ctx: CorrectionContext,
  stage: CorrectionStage,
  state: CorrectionToolState,
): Promise<{ result: ToolResult; stateUpdate: Partial<CorrectionToolState> }> {
  if (!state.pendingChanges) {
    return {
      result: { success: false, summary: 'No preview generated yet. Call preview_changes first.' },
      stateUpdate: {},
    };
  }

  if (args.confirmed !== true) {
    return {
      result: { success: false, summary: 'User did not confirm. Changes NOT applied.' },
      stateUpdate: { pendingChanges: null, pendingExplanation: null },
    };
  }

  const changes = state.pendingChanges;

  try {
    if (stage === 'scan') {
      await applyScanChanges(ctx, changes);
    } else if (stage === 'enrich') {
      await applyEnrichChanges(ctx, changes);
    } else if (stage === 'postcard') {
      await applyPostcardChanges(ctx, changes);
    }

    return {
      result: {
        success: true,
        summary: `Changes applied successfully to ${stage} record. Updated fields: ${Object.keys(changes).join(', ')}`,
        data: { updatedFields: Object.keys(changes) },
      },
      stateUpdate: { applied: true, pendingChanges: null, pendingExplanation: null },
    };
  } catch (e) {
    return {
      result: { success: false, summary: `Failed to apply changes: ${(e as Error).message}` },
      stateUpdate: {},
    };
  }
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

  const visualFields = ['postcardHeadline', 'postcardDescription', 'accentColor', 'backgroundPrompt', 'contactPhoto', 'teamPhotos', 'companyLogo'];
  const visualChanged = visualFields.some((f) => f in changes);

  const data: Record<string, unknown> = { ...changes };
  if (visualChanged) {
    data.imageUrl = null;
    data.backgroundUrl = null;
    data.status = 'pending';
  }

  await prisma.postcard.update({ where: { id: ctx.postcardId }, data });
}

function getCurrentData(ctx: CorrectionContext, stage: CorrectionStage): Record<string, unknown> {
  if (stage === 'scan') {
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
  if (stage === 'enrich' && ctx.enrichment) {
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
  if (stage === 'postcard' && ctx.postcard) {
    return {
      template: ctx.postcard.template,
      postcardHeadline: ctx.postcard.postcardHeadline,
      postcardDescription: ctx.postcard.postcardDescription,
      accentColor: ctx.postcard.accentColor,
      backMessage: ctx.postcard.backMessage,
      contactName: ctx.postcard.contactName,
      contactTitle: ctx.postcard.contactTitle,
      deliveryAddress: ctx.postcard.deliveryAddress,
      companyLogo: ctx.postcard.companyLogo,
      contactPhoto: ctx.postcard.contactPhoto,
      teamPhotos: ctx.postcard.teamPhotos,
    };
  }
  return {};
}
