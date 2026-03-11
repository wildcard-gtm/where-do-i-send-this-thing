import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient({
  datasourceUrl: process.env.SUPABASE_DB_URL,
});

interface TeamPhoto {
  name?: string;
  photoUrl: string;
  title?: string;
  linkedinUrl?: string;
}

function extractSlug(url: string): string | null {
  try {
    const decoded = decodeURIComponent(url);
    const match = decoded.match(/linkedin\.com\/in\/([^/?#]+)/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

async function main() {
  // Read CSV to get our target LinkedIn URLs
  const csvPath = path.resolve(__dirname, "../../missing.csv");
  // D:\wildcard\missing.csv
  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.trim().split("\n").slice(1); // skip header

  function parseCsvRow(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === "," && !inQuotes) { fields.push(current.trim()); current = ""; }
      else { current += ch; }
    }
    fields.push(current.trim());
    return fields;
  }

  // Collect unique slugs from CSV
  const targetSlugs = new Set<string>();
  for (const line of lines) {
    const fields = parseCsvRow(line);
    const url = fields[6]; // LinkedIn URL column
    const slug = extractSlug(url);
    if (slug) targetSlugs.add(slug);
  }
  console.log(`Target slugs from CSV: ${targetSlugs.size}`);

  // Query all contacts with enrichments
  const contacts = await prisma.contact.findMany({
    select: {
      id: true,
      name: true,
      company: true,
      linkedinUrl: true,
      companyEnrichments: {
        where: { isLatest: true, enrichmentStatus: "completed" },
        select: { id: true, companyName: true, teamPhotos: true },
        take: 1,
      },
    },
  });

  interface Lead {
    type: "contact" | "team";
    contactId: string;
    enrichmentId?: string;
    teamIndex?: number;
    name: string;
    company: string;
    linkedinUrl: string;
    slug: string;
  }

  const leads: Lead[] = [];
  const foundSlugs = new Set<string>();

  for (const c of contacts) {
    // Check if the contact itself is one of our targets
    const contactSlug = extractSlug(c.linkedinUrl);
    if (contactSlug && targetSlugs.has(contactSlug) && !foundSlugs.has(contactSlug)) {
      leads.push({
        type: "contact",
        contactId: c.id,
        name: c.name,
        company: c.company ?? "Unknown",
        linkedinUrl: c.linkedinUrl,
        slug: contactSlug,
      });
      foundSlugs.add(contactSlug);
    }

    // Check team members
    const enrichment = c.companyEnrichments[0];
    if (!enrichment) continue;
    const teamPhotos = enrichment.teamPhotos as TeamPhoto[] | null;
    if (!teamPhotos) continue;

    for (let i = 0; i < teamPhotos.length; i++) {
      const tp = teamPhotos[i];
      if (!tp.linkedinUrl) continue;
      const teamSlug = extractSlug(tp.linkedinUrl);
      if (teamSlug && targetSlugs.has(teamSlug) && !foundSlugs.has(teamSlug)) {
        leads.push({
          type: "team",
          contactId: c.id,
          enrichmentId: enrichment.id,
          teamIndex: i,
          name: tp.name ?? "Unknown",
          company: enrichment.companyName ?? c.company ?? "Unknown",
          linkedinUrl: tp.linkedinUrl,
          slug: teamSlug,
        });
        foundSlugs.add(teamSlug);
      }
    }
  }

  // Report missing
  const missingSlugs = [...targetSlugs].filter(s => !foundSlugs.has(s));
  if (missingSlugs.length > 0) {
    console.log(`\nWARNING: ${missingSlugs.length} slugs not found in DB:`);
    for (const s of missingSlugs) console.log(`  - ${s}`);
  }

  console.log(`\nFound ${leads.length} leads with DB IDs`);

  // Write leads.js for the extension
  const outPath = path.resolve(__dirname, "../chrome-extension-refresh/leads.js");
  const jsContent = `// Auto-generated from missing.csv + Supabase DB query
// Each lead has the DB IDs needed for /api/photos/upload
const LEADS = ${JSON.stringify(leads, null, 2)};
`;
  fs.writeFileSync(outPath, jsContent, "utf-8");
  console.log(`Written to ${outPath}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
