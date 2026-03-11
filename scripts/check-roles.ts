import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasourceUrl: process.env.SUPABASE_DB_URL,
});

async function main() {
  const contacts = await prisma.contact.findMany({
    where: { name: { contains: "Aaron Moss" } },
    select: {
      id: true,
      name: true,
      company: true,
      companyEnrichments: {
        where: { isLatest: true },
        select: {
          id: true,
          openRoles: true,
          companyName: true,
        },
      },
      feedbacks: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
        },
      },
      postcards: {
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          id: true,
          status: true,
          customPrompt: true,
          createdAt: true,
        },
      },
    },
  });

  for (const c of contacts) {
    console.log(`\n=== ${c.name} (${c.company}) ===`);
    console.log(`Contact ID: ${c.id}`);

    const enrichment = c.companyEnrichments[0];
    if (enrichment) {
      console.log(`\nEnrichment ID: ${enrichment.id}`);
      console.log(`openRoles:`, JSON.stringify(enrichment.openRoles, null, 2));
    }

    if (c.feedbacks.length > 0) {
      console.log(`\nFeedback (${c.feedbacks.length}):`);
      for (const f of c.feedbacks) {
        console.log(`  ${f.createdAt} | ${f.rating} | ${f.comment}`);
      }
    }

    if (c.postcards.length > 0) {
      console.log(`\nPostcards (${c.postcards.length}):`);
      for (const p of c.postcards) {
        console.log(`  ${p.id} | ${p.status} | ${p.createdAt}`);
        if (p.customPrompt) console.log(`  customPrompt: ${p.customPrompt}`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
