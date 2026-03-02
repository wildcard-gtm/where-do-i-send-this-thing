/**
 * One-time migration: create "MEMS Studio" team, add Sammy + Shane as owners,
 * and stamp teamId on all their existing records.
 *
 * Run: npx tsx scripts/migrate-teams.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SAMMY_EMAIL = "sammy@mems.studio";
const SHANE_EMAIL = "shane@mems.studio";
const TEAM_NAME = "MEMS Studio";

async function main() {
  console.log("\nStarting team migration...\n");

  // ── 1. Find users ─────────────────────────────────────────────────────────
  const sammy = await prisma.user.findUnique({ where: { email: SAMMY_EMAIL } });
  const shane = await prisma.user.findUnique({ where: { email: SHANE_EMAIL } });

  if (!sammy) throw new Error(`User not found: ${SAMMY_EMAIL}`);
  if (!shane) throw new Error(`User not found: ${SHANE_EMAIL}`);

  console.log(`Found Sammy: ${sammy.id}`);
  console.log(`Found Shane: ${shane.id}`);

  // ── 2. Create or find team ────────────────────────────────────────────────
  let team = await prisma.team.findFirst({ where: { name: TEAM_NAME } });
  if (team) {
    console.log(`\nTeam "${TEAM_NAME}" already exists: ${team.id}`);
  } else {
    team = await prisma.team.create({ data: { name: TEAM_NAME } });
    console.log(`\nCreated team "${TEAM_NAME}": ${team.id}`);
  }

  const teamId = team.id;
  const memberIds = [sammy.id, shane.id];

  // ── 3. Upsert TeamMember records ──────────────────────────────────────────
  for (const userId of memberIds) {
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      update: { role: "owner" },
      create: { teamId, userId, role: "owner" },
    });
  }
  console.log(`Added ${memberIds.length} team owners (Sammy + Shane)`);

  // ── 4. Stamp teamId on User records ──────────────────────────────────────
  await prisma.user.updateMany({
    where: { id: { in: memberIds } },
    data: { teamId },
  });
  console.log("Stamped User.teamId");

  // ── 5. Stamp teamId on all Batch records ──────────────────────────────────
  const batchResult = await prisma.batch.updateMany({
    where: { userId: { in: memberIds }, teamId: null },
    data: { teamId },
  });
  console.log(`Stamped Batch.teamId: ${batchResult.count} rows`);

  // ── 6. Stamp teamId on Contact records ────────────────────────────────────
  const contactResult = await prisma.contact.updateMany({
    where: { userId: { in: memberIds }, teamId: null },
    data: { teamId },
  });
  console.log(`Stamped Contact.teamId: ${contactResult.count} rows`);

  // ── 7. Stamp teamId on EnrichmentBatch records ────────────────────────────
  const enrichResult = await prisma.enrichmentBatch.updateMany({
    where: { userId: { in: memberIds }, teamId: null },
    data: { teamId },
  });
  console.log(`Stamped EnrichmentBatch.teamId: ${enrichResult.count} rows`);

  // ── 8. Stamp teamId on PostcardBatch records ──────────────────────────────
  const postcardBatchResult = await prisma.postcardBatch.updateMany({
    where: { userId: { in: memberIds }, teamId: null },
    data: { teamId },
  });
  console.log(`Stamped PostcardBatch.teamId: ${postcardBatchResult.count} rows`);

  console.log("\nMigration complete!\n");
}

main().catch(async (err) => {
  await prisma.$disconnect();
  console.error("Migration error:", err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
