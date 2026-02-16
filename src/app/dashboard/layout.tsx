import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import DashboardShell from "@/components/layout/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/auth/signin");
  }

  // Fetch role from DB (JWT may not have it for older sessions)
  const dbUser = await prisma.user.findUnique({
    where: { id: session.id },
    select: { role: true },
  });

  const user = { ...session, role: dbUser?.role ?? "user" };

  return <DashboardShell user={user}>{children}</DashboardShell>;
}
