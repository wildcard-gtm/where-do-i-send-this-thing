/**
 * CLI entry point for the Address Verification Agent.
 *
 * Usage:
 *   npx tsx src/agent/index.ts <linkedin-url-or-person-info>
 *
 * Examples:
 *   npx tsx src/agent/index.ts "https://www.linkedin.com/in/john-doe"
 *   npx tsx src/agent/index.ts "Jane Smith, CTO at Acme Corp, San Francisco"
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from './agent';

async function main() {
  const input = process.argv[2];

  if (!input) {
    console.error('Usage: npx tsx src/agent/index.ts <linkedin-url-or-person-info>');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx src/agent/index.ts "https://www.linkedin.com/in/john-doe"');
    console.error('  npx tsx src/agent/index.ts "Jane Smith, CTO at Acme Corp, San Francisco"');
    process.exit(1);
  }

  const result = await runAgent(input);

  const outputPath = join(process.cwd(), 'results.json');
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`Results saved to: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
