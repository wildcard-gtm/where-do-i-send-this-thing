import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // List all users
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true, name: true } });
  console.log("Current users:");
  users.forEach(u => console.log(`  ${u.name} (${u.email}) - role: ${u.role}`));

  // Set all current users as admin (Shane and Sammy)
  const result = await prisma.user.updateMany({
    data: { role: "admin" },
  });
  console.log(`\nUpdated ${result.count} users to admin role.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
