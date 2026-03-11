import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasourceUrl: process.env.SUPABASE_DB_URL,
});

async function main() {
  // Check customPrompt on postcards for role-related instructions
  const postcards = await prisma.postcard.findMany({
    where: {
      customPrompt: { not: null },
    },
    select: {
      id: true,
      customPrompt: true,
      contactName: true,
      contact: {
        select: {
          name: true,
          company: true,
          companyEnrichments: {
            where: { isLatest: true },
            select: {
              id: true,
              openRoles: true,
            },
            take: 1,
          },
        },
      },
    },
  });

  const roleKeywords = [
    /\bSW\b/, /\bshorten/i, /\babbreviat/i, /\btitle/i, /\brole/i,
    /\bremove\b/i, /\brename\b/i, /\breplace\b/i, /\bengineer/i,
    /\bSr\b/, /\bEng\b/, /\bDev\b/, /\bMgmt\b/, /\bOps\b/,
  ];

  let count = 0;
  for (const p of postcards) {
    const prompt = p.customPrompt || "";
    if (!roleKeywords.some(kw => kw.test(prompt))) continue;

    count++;
    const enrichment = p.contact.companyEnrichments[0];
    const roles = enrichment?.openRoles as Array<{ title: string }> | null;

    console.log(`\n${"─".repeat(80)}`);
    console.log(`${p.contact.name} (${p.contact.company})`);
    console.log(`Custom prompt: "${prompt}"`);
    console.log(`Enrichment ID: ${enrichment?.id || "NONE"}`);
    if (roles) {
      console.log(`Current roles:`);
      for (const r of roles) {
        console.log(`  • ${r.title}`);
      }
    }
  }

  console.log(`\n\nTotal postcards with role-related custom prompts: ${count}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
