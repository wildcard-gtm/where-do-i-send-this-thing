/**
 * Backup script — dumps all DB tables to JSON + zips with source files.
 * Output: backups/backup-YYYY-MM-DD-HHmm.zip (gitignored)
 * Run: npx tsx scripts/backup.ts
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import JSZip from "jszip";

const prisma = new PrismaClient();
const ROOT = path.join(__dirname, "..");
const BACKUP_DIR = path.join(ROOT, "backups");

const stamp = new Date()
  .toISOString()
  .replace(/T/, "-")
  .replace(/:/g, "")
  .slice(0, 15); // YYYY-MM-DD-HHmm

const ZIP_NAME = `backup-${stamp}.zip`;

// Source dirs/files to include (relative to ROOT)
const SOURCE_INCLUDE = [
  "src",
  "prisma",
  "public",
  "prompts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "tailwind.config.ts",
  ".env",
];

// Extensions to skip (binaries, generated)
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".node", ".dll"]);

async function collectFiles(dir: string, zip: JSZip, zipPrefix: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    const rel = path.join(zipPrefix, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, zip, rel);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (SKIP_EXT.has(ext)) continue;
      zip.file(rel.replace(/\\/g, "/"), fs.readFileSync(full));
    }
  }
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  console.log(`\nBacking up to: backups/${ZIP_NAME}\n`);

  const zip = new JSZip();

  // ── 1. Dump DB tables ─────────────────────────────────────────────────────
  console.log("Dumping database tables...");

  const tables: Record<string, unknown[]> = {
    users:              await prisma.user.findMany(),
    batches:            await prisma.batch.findMany(),
    jobs:               await prisma.job.findMany(),
    agentEvents:        await prisma.agentEvent.findMany(),
    contacts:           await prisma.contact.findMany(),
    chatMessages:       await prisma.chatMessage.findMany(),
    systemPrompts:      await prisma.systemPrompt.findMany(),
    feedbacks:          await prisma.feedback.findMany(),
    contactMessages:    await prisma.contactMessage.findMany(),
    postcardBatches:    await prisma.postcardBatch.findMany(),
    enrichmentBatches:  await prisma.enrichmentBatch.findMany(),
    companyEnrichments: await prisma.companyEnrichment.findMany(),
    contactRevisions:   await prisma.contactRevision.findMany(),
    postcards:          await prisma.postcard.findMany(),
  };

  for (const [table, rows] of Object.entries(tables)) {
    const json = JSON.stringify(rows, null, 2);
    zip.file(`db/${table}.json`, json);
    console.log(`  ${table}: ${rows.length} rows`);
  }

  await prisma.$disconnect();

  // ── 2. Add source files ───────────────────────────────────────────────────
  console.log("\nAdding source files...");
  let fileCount = 0;

  for (const item of SOURCE_INCLUDE) {
    const full = path.join(ROOT, item);
    if (!fs.existsSync(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      const before = Object.keys(zip.files).length;
      await collectFiles(full, zip, `src-files/${item}`);
      const added = Object.keys(zip.files).length - before;
      fileCount += added;
      console.log(`  ${item}/  (+${added} files)`);
    } else {
      zip.file(`src-files/${item}`, fs.readFileSync(full));
      fileCount++;
      console.log(`  ${item}`);
    }
  }

  // ── 3. Write zip ──────────────────────────────────────────────────────────
  console.log(`\nWriting zip (${fileCount} source files + ${Object.keys(tables).length} DB tables)...`);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const outPath = path.join(BACKUP_DIR, ZIP_NAME);
  fs.writeFileSync(outPath, buf);

  const sizeMb = (buf.length / 1024 / 1024).toFixed(1);
  console.log(`\nDone: ${outPath} (${sizeMb} MB)\n`);
}

main().catch(async (err) => {
  await prisma.$disconnect();
  console.error(err);
  process.exit(1);
});
