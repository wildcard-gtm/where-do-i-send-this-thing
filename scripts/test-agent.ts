/**
 * Local agent test tool
 *
 * Single URL:
 *   npx tsx --tsconfig tsconfig.json scripts/test-agent.ts https://linkedin.com/in/frankchang
 *
 * Batch compare against ground truth CSV:
 *   npx tsx --tsconfig tsconfig.json scripts/test-agent.ts --batch d:/wildcard/address_verification_test.csv
 *
 * Loads .env automatically. Uses the same agent code and prompts/ files as production.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { runAgentStreaming, type AgentStreamEvent } from '../src/agent/agent-streaming';
import type { AgentDecision } from '../src/agent/types';

// ─── Ground truth type ────────────────────────────────────
interface GroundTruth {
  name: string;
  linkedinUrl: string;
  expectedAddress: string;
}

interface BatchResult {
  name: string;
  linkedinUrl: string;
  expectedAddress: string;
  recommendation: string | null;
  homeAddress: string | null;
  officeAddress: string | null;
  confidence: number | null;
  addrFound: boolean;
  noDecision: boolean;
}

// ─── Normalise address for fuzzy matching ─────────────────
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\bten+th\b/g, '10')   // Tenth -> 10
    .replace(/[,\.#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addressMatches(expected: string, got: string | undefined): boolean {
  if (!got) return false;
  const e = norm(expected);
  const g = norm(got);
  // Match on first two tokens (street number + street name)
  const keyTokens = e.split(' ').slice(0, 2).join(' ');
  return g.includes(keyTokens);
}

// ─── Run a single LinkedIn URL through the agent ──────────
async function runOne(url: string, groundTruth?: GroundTruth): Promise<BatchResult | null> {
  const sep = '═'.repeat(70);
  console.log(`\n${sep}`);
  if (groundTruth) {
    console.log(`  ${groundTruth.name}`);
    console.log(`  Expected: ${groundTruth.expectedAddress}`);
  }
  console.log(`  URL: ${url}`);
  console.log(sep);

  let toolCallCount = 0;

  const result = await runAgentStreaming(url, (event: AgentStreamEvent) => {
    switch (event.type) {
      case 'agent_start':
        console.log(`\n[START] Model: ${(event.data as Record<string,unknown>).model ?? 'unknown'}`);
        break;
      case 'iteration_start':
        process.stdout.write(`  iter ${event.iteration}  `);
        break;
      case 'thinking': {
        const text = String((event.data as Record<string,unknown>).text ?? '').slice(0, 120).replace(/\n/g, ' ');
        if (text) console.log(`\n  [think] ${text}...`);
        break;
      }
      case 'tool_call_start': {
        const d = event.data as Record<string,unknown>;
        toolCallCount++;
        process.stdout.write(`\n    [CALL] ${d.toolName} `);
        const input = d.toolInput as Record<string,unknown>;
        const brief = Object.entries(input).map(([k,v]) => `${k}=${JSON.stringify(v).slice(0,40)}`).join(', ');
        process.stdout.write(`(${brief})`);
        break;
      }
      case 'tool_call_result': {
        const d = event.data as Record<string,unknown>;
        const ok = d.success ? '✓' : '✗';
        console.log(`\n    [RESULT] ${ok} ${d.summary}`);
        break;
      }
      case 'decision_rejected': {
        const d = event.data as Record<string,unknown>;
        console.log(`\n  [REJECTED] Confidence ${d.confidence}% < threshold`);
        break;
      }
      case 'decision_accepted':
        console.log(`\n  [ACCEPTED]`);
        break;
      case 'error':
        console.log(`\n  [ERROR] ${(event.data as Record<string,unknown>).message}`);
        break;
      case 'complete':
        console.log('');
        break;
    }
  });

  // ─── Print final decision ───────────────────────────────
  console.log(`\n${'─'.repeat(70)}`);

  if (!result.decision) {
    console.log('  RESULT: NO DECISION SUBMITTED');
    console.log(`  Iterations: ${result.iterations} / Tool calls: ${toolCallCount}`);
    console.log('─'.repeat(70));
    if (!groundTruth) return null;
    return {
      name: groundTruth.name,
      linkedinUrl: url,
      expectedAddress: groundTruth.expectedAddress,
      recommendation: null,
      homeAddress: null,
      officeAddress: null,
      confidence: null,
      addrFound: false,
      noDecision: true,
    };
  }

  const d = result.decision as AgentDecision;
  console.log(`  RESULT:     ${d.recommendation} (${d.confidence}%)`);
  console.log(`  Home:       ${d.home_address?.address ?? '—'} (${d.home_address?.confidence ?? '—'}%)`);
  console.log(`  Office:     ${d.office_address?.address ?? '—'} (${d.office_address?.confidence ?? '—'}%)`);
  console.log(`  Iterations: ${result.iterations} / Tool calls: ${toolCallCount}`);
  if (d.flags?.length) console.log(`  Flags:      ${d.flags.join(', ')}`);

  let addrFound = false;
  if (groundTruth) {
    addrFound =
      addressMatches(groundTruth.expectedAddress, d.home_address?.address) ||
      addressMatches(groundTruth.expectedAddress, d.office_address?.address);

    const verdict = addrFound ? '✅ ADDRESS FOUND' : '❌ ADDRESS MISS';
    console.log(`\n  ${verdict}`);
    if (!addrFound) {
      const primaryAddr = d.recommendation === 'HOME' ? d.home_address?.address
        : d.recommendation === 'OFFICE' ? d.office_address?.address
        : (d.home_address?.address || d.office_address?.address);
      console.log(`  Expected: ${groundTruth.expectedAddress}`);
      console.log(`  Got:      ${primaryAddr ?? '(none)'}`);
    }
  }
  console.log('─'.repeat(70));

  if (!groundTruth) return null;
  return {
    name: groundTruth.name,
    linkedinUrl: url,
    expectedAddress: groundTruth.expectedAddress,
    recommendation: d.recommendation,
    homeAddress: d.home_address?.address ?? null,
    officeAddress: d.office_address?.address ?? null,
    confidence: d.confidence,
    addrFound,
    noDecision: false,
  };
}

// ─── Parse ground truth CSV ───────────────────────────────
function parseGroundTruth(csvPath: string): GroundTruth[] {
  const lines = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(Boolean);
  const results: GroundTruth[] = [];
  for (const line of lines.slice(1)) {
    // CSV: reference_code,full_name,linkedin_url,delivery_address
    const match = line.match(/^[^,]+,"?([^,"]+)"?,"?([^,"]+)"?,"?(.+?)"?\s*$/);
    if (!match) continue;
    const [, name, linkedinUrl, expectedAddress] = match;
    if (linkedinUrl?.includes('linkedin.com')) {
      results.push({ name: name.trim(), linkedinUrl: linkedinUrl.trim(), expectedAddress: expectedAddress.trim() });
    }
  }
  return results;
}

// ─── Main ─────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--batch') {
    const csvPath = args[1];
    if (!csvPath || !fs.existsSync(csvPath)) {
      console.error('Usage: --batch <path-to-ground-truth.csv>');
      process.exit(1);
    }

    const leads = parseGroundTruth(csvPath);
    console.log(`\nBatch mode: ${leads.length} leads from ${path.basename(csvPath)}`);

    const batchResults: BatchResult[] = [];

    for (const lead of leads) {
      const r = await runOne(lead.linkedinUrl, lead);
      if (r) batchResults.push(r);
    }

    // ─── Final accuracy report ─────────────────────────────
    const total = batchResults.length;
    const found = batchResults.filter(r => r.addrFound).length;
    const noDecision = batchResults.filter(r => r.noDecision).length;
    const missed = total - found - noDecision;

    console.log(`\n${'═'.repeat(70)}`);
    console.log('  BATCH ACCURACY REPORT');
    console.log(`${'═'.repeat(70)}`);
    console.log(`  Total leads:       ${total}`);
    console.log(`  Address found:     ${found}/${total} (${Math.round(found/total*100)}%)`);
    console.log(`  Address missed:    ${missed}/${total}`);
    console.log(`  No decision:       ${noDecision}/${total}`);
    console.log('');
    console.log('  PER-LEAD SUMMARY:');
    for (const r of batchResults) {
      const icon = r.noDecision ? '[ ]' : r.addrFound ? '[✓]' : '[✗]';
      const rec = r.recommendation ?? 'NO-DEC';
      const addr = r.recommendation === 'HOME' ? r.homeAddress
        : r.recommendation === 'OFFICE' ? r.officeAddress
        : (r.homeAddress || r.officeAddress);
      console.log(`  ${icon} ${r.name.padEnd(30)} ${rec.padEnd(7)} ${addr ?? '(none)'}`);
    }
    console.log(`${'═'.repeat(70)}\n`);

  } else if (args[0]) {
    await runOne(args[0]);
  } else {
    console.log(`
Usage:
  Single URL:
    npx tsx --tsconfig tsconfig.json scripts/test-agent.ts <linkedin_url>

  Batch compare:
    npx tsx --tsconfig tsconfig.json scripts/test-agent.ts --batch <ground_truth.csv>

Example:
  npx tsx --tsconfig tsconfig.json scripts/test-agent.ts https://linkedin.com/in/frankchang
  npx tsx --tsconfig tsconfig.json scripts/test-agent.ts --batch d:/wildcard/address_verification_test.csv
`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
