import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasourceUrl: process.env.SUPABASE_DB_URL,
});

async function main() {
  // Get all feedback with comments
  const feedbacks = await prisma.feedback.findMany({
    where: { comment: { not: null } },
    select: {
      id: true,
      comment: true,
      contactId: true,
      createdAt: true,
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

  // Filter for role-related feedback
  const roleKeywords = [
    /\brole\b/i, /\btitle\b/i, /\bSW\b/, /\bshorten/i, /\babbreviat/i,
    /\bSr\b/, /\bJr\b/, /\bEng\b/, /\bMgmt\b/, /\bOps\b/, /\bDev\b/,
    /\bremove\b/i, /\brename\b/i, /\bchange.*to\b/i, /\breplace\b/i,
    /\bsoftware\b/i, /\bengineer\b/i, /\bmanager\b/i, /\bdirector\b/i,
    /\bwhiteboard\b/i, /\bjob\b/i, /\bposition\b/i,
  ];

  let count = 0;
  for (const f of feedbacks) {
    const comment = f.comment || "";
    if (!roleKeywords.some(kw => kw.test(comment))) continue;

    // Skip visual-only feedback
    const visualOnly = [
      /\blook/i, /\bphoto/i, /\bimage/i, /\bpicture/i, /\bface\b/i,
      /\blogo\b/i, /\bcolor/i, /\bbackground/i, /\bsilhouette/i,
      /\bcareer page/i, /\blookup/i, /\bcheck.*page/i, /\bsearch/i,
    ];
    // Don't skip if it also mentions role changes
    const hasRoleChange = /\bSW\b|shorten|abbreviat|remove|rename|change.*to|replace.*with/i.test(comment);
    if (!hasRoleChange && visualOnly.some(kw => kw.test(comment))) continue;

    count++;
    const enrichment = f.contact.companyEnrichments[0];
    const roles = enrichment?.openRoles as Array<{ title: string; location: string }> | null;

    console.log(`\n${"─".repeat(80)}`);
    console.log(`${f.contact.name} (${f.contact.company})`);
    console.log(`Feedback: "${comment}"`);
    console.log(`Enrichment ID: ${enrichment?.id || "NONE"}`);
    if (roles) {
      console.log(`Current roles:`);
      for (const r of roles) {
        console.log(`  • ${r.title}`);
      }
    }
  }

  console.log(`\n\nTotal role-related feedback: ${count}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
