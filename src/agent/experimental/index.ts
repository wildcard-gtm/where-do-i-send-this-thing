/**
 * CLI entry point for the Experimental Address Verification Agent v1.
 *
 * Usage:
 *   npx tsx src/agent/experimental/index.ts <linkedin-url-or-person-info>
 *
 * Examples:
 *   npx tsx src/agent/experimental/index.ts "https://www.linkedin.com/in/john-doe"
 *   npx tsx src/agent/experimental/index.ts "Jane Smith, CTO at Acme Corp, San Francisco"
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runExperimentalAgent } from './agent';

async function main() {
  const input = process.argv[2];

  if (!input) {
    console.error('Usage: npx tsx src/agent/experimental/index.ts <linkedin-url-or-person-info>');
    console.error('');
    console.error('Experimental agent with additional data sources:');
    console.error('  - FEC campaign donation records (home addresses)');
    console.error('  - OpenCorporates officer search (registered addresses)');
    console.error('  - Census income data (neighborhood scoring)');
    console.error('  - Commute probability scoring');
    process.exit(1);
  }

  const result = await runExperimentalAgent(input);

  const outputPath = join(process.cwd(), 'results-experimental.json');
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`Results saved to: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
