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

async function main() {
  const csvPath = path.resolve(__dirname, "../../missing.csv");
  const raw = fs.readFileSync(csvPath, "utf-8");
  const lines = raw.trim().split("\n");
  const header = lines[0];
  const rows = lines.slice(1);

  // Parse CSV rows (handles quoted fields)
  function parseCsvRow(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  // Build lookup: name -> row data
  const entries = rows.map((line) => {
    const fields = parseCsvRow(line);
    return {
      name: fields[0],
      role: fields[1],
      company: fields[2],
      photoASource: fields[3],
      photoBSource: fields[4],
      issue: fields[5],
      linkedinUrl: "", // to be filled
    };
  });

  console.log(`Loaded ${entries.length} rows from CSV\n`);

  // 1) Query Contact table for all names
  const contactNames = entries.map((e) => e.name);
  const contacts = await prisma.contact.findMany({
    where: {
      name: { in: contactNames },
    },
    select: { name: true, linkedinUrl: true, company: true },
  });

  const contactMap = new Map<string, string>();
  for (const c of contacts) {
    contactMap.set(c.name.toLowerCase(), c.linkedinUrl);
  }
  console.log(`Found ${contacts.length} matches in Contact table`);

  // 2) Query CompanyEnrichment teamPhotos for team members
  const enrichments = await prisma.companyEnrichment.findMany({
    where: { isLatest: true, teamPhotos: { not: undefined } },
    select: { teamPhotos: true, contactId: true },
  });

  const teamMap = new Map<string, string>(); // name -> linkedinUrl
  for (const e of enrichments) {
    if (!e.teamPhotos) continue;
    const photos = e.teamPhotos as TeamPhoto[];
    for (const p of photos) {
      if (p.name && p.linkedinUrl) {
        teamMap.set(p.name.toLowerCase(), p.linkedinUrl);
      }
    }
  }
  console.log(`Found ${teamMap.size} team members with LinkedIn URLs in enrichments\n`);

  // 3) Match entries
  let matched = 0;
  let unmatched = 0;
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    if (contactMap.has(key)) {
      entry.linkedinUrl = contactMap.get(key)!;
      matched++;
    } else if (teamMap.has(key)) {
      entry.linkedinUrl = teamMap.get(key)!;
      matched++;
    } else {
      // Try fuzzy: check if any contact/team name contains or is contained by entry name
      let found = false;
      for (const [k, v] of contactMap) {
        if (k.includes(key) || key.includes(k)) {
          entry.linkedinUrl = v;
          matched++;
          found = true;
          console.log(`  Fuzzy contact match: "${entry.name}" → "${k}"`);
          break;
        }
      }
      if (!found) {
        for (const [k, v] of teamMap) {
          if (k.includes(key) || key.includes(k)) {
            entry.linkedinUrl = v;
            matched++;
            found = true;
            console.log(`  Fuzzy team match: "${entry.name}" → "${k}"`);
            break;
          }
        }
      }
      if (!found) {
        unmatched++;
        console.log(`  NO MATCH: "${entry.name}" (${entry.company})`);
      }
    }
  }

  console.log(`\nMatched: ${matched}, Unmatched: ${unmatched}`);

  // 4) Write updated CSV
  const outLines = [header + ",LinkedIn URL"];
  for (const entry of entries) {
    const fields = [
      entry.name.includes(",") ? `"${entry.name}"` : entry.name,
      entry.role,
      entry.company.includes(",") ? `"${entry.company}"` : entry.company,
      entry.photoASource,
      entry.photoBSource,
      entry.issue,
      entry.linkedinUrl,
    ];
    outLines.push(fields.join(","));
  }

  const outPath = path.resolve(__dirname, "../../missing.csv");
  fs.writeFileSync(outPath, outLines.join("\n") + "\n", "utf-8");
  console.log(`\nUpdated CSV written to ${outPath}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
