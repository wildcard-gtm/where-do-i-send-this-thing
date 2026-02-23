/**
 * Team helpers — resolves the set of userIds that share data with the current session user.
 *
 * If user has a teamId:  returns all member userIds of that team.
 * If user is solo:        returns [user.id] — data is scoped to themselves only.
 *
 * Use `getTeamUserIds` everywhere a Prisma query would normally filter by `userId: user.id`.
 * Replace with `userId: { in: teamUserIds }`.
 */
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";

export async function getTeamUserIds(user: SessionUser): Promise<string[]> {
  if (!user.teamId) return [user.id];

  const members = await prisma.teamMember.findMany({
    where: { teamId: user.teamId },
    select: { userId: true },
  });

  const ids = members.map((m) => m.userId);
  // Always include self even if somehow not in TeamMember
  if (!ids.includes(user.id)) ids.push(user.id);
  return ids;
}

export async function getTeamWithMembers(teamId: string) {
  return prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      templates: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}
