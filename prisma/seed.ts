import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("Wildcard@2026", 10);

  await prisma.user.upsert({
    where: { email: "sammy@mems.studio" },
    update: {},
    create: {
      email: "sammy@mems.studio",
      password,
      name: "Sammy",
    },
  });

  await prisma.user.upsert({
    where: { email: "shane@mems.studio" },
    update: {},
    create: {
      email: "shane@mems.studio",
      password,
      name: "Shane",
    },
  });

  console.log("Seeded 2 users: sammy@mems.studio, shane@mems.studio");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
