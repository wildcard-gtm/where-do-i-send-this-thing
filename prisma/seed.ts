import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("Wildcard@2026", 10);

  // Find or create team
  let team = await prisma.team.findFirst({ where: { name: "Mems" } });
  if (!team) {
    team = await prisma.team.create({ data: { name: "Mems" } });
  }

  const sammy = await prisma.user.upsert({
    where: { email: "sammy@mems.studio" },
    update: { teamId: team.id },
    create: {
      email: "sammy@mems.studio",
      password,
      name: "Sammy",
      teamId: team.id,
    },
  });

  const shane = await prisma.user.upsert({
    where: { email: "shane@mems.studio" },
    update: { teamId: team.id },
    create: {
      email: "shane@mems.studio",
      password,
      name: "Shane",
      teamId: team.id,
    },
  });

  // Upsert team members
  for (const user of [sammy, shane]) {
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId: user.id } },
      update: {},
      create: { teamId: team.id, userId: user.id, role: "admin" },
    });
  }

  console.log(`Seeded team "${team.name}" with 2 members: sammy, shane`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
