import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import AnalyticsCharts, { type AnalyticsData } from "@/components/dashboard/analytics-charts";

export default async function DashboardPage() {
  const user = await getSession();

  const [batches, contactCount, jobStats] = await Promise.all([
    user
      ? prisma.batch.findMany({
          where: { userId: user.id },
          include: { jobs: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        })
      : [],
    user ? prisma.contact.count({ where: { userId: user.id } }) : 0,
    user
      ? prisma.job.aggregate({
          where: { batch: { userId: user.id }, status: "complete" },
          _count: true,
          _avg: { confidence: true },
        })
      : { _count: 0, _avg: { confidence: null } },
  ]);

  const totalScans = user
    ? await prisma.batch.count({ where: { userId: user.id } })
    : 0;

  const recentContacts = user
    ? await prisma.contact.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];

  // ─── Analytics data ───
  const analyticsData: AnalyticsData = await (async () => {
    if (!user) {
      return {
        recommendations: [],
        confidenceBuckets: [],
        scanTrends: [],
        successRate: 0,
        failureRate: 0,
        totalJobs: 0,
      };
    }

    const [recCounts, allConfidences, jobStatusCounts, batchesForTrend, contactsForTrend] =
      await Promise.all([
        // Recommendation breakdown
        prisma.contact.groupBy({
          by: ["recommendation"],
          where: { userId: user.id, recommendation: { not: null } },
          _count: true,
        }),
        // Confidence values for histogram
        prisma.contact.findMany({
          where: { userId: user.id, confidence: { not: null } },
          select: { confidence: true },
        }),
        // Job status counts for success/failure rate
        prisma.job.groupBy({
          by: ["status"],
          where: { batch: { userId: user.id }, status: { in: ["complete", "failed"] } },
          _count: true,
        }),
        // Batches created per week (last 8 weeks)
        prisma.batch.findMany({
          where: {
            userId: user.id,
            createdAt: { gte: new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000) },
          },
          select: { createdAt: true },
        }),
        // Contacts created per week (last 8 weeks)
        prisma.contact.findMany({
          where: {
            userId: user.id,
            createdAt: { gte: new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000) },
          },
          select: { createdAt: true },
        }),
      ]);

    // Recommendation breakdown
    const recColorMap: Record<string, string> = {
      HOME: "#22c55e",
      OFFICE: "#4f6ef7",
      BOTH: "#f59e0b",
    };
    const recommendations = recCounts.map((r) => ({
      name: r.recommendation || "Unknown",
      value: r._count,
      color: recColorMap[r.recommendation || ""] || "#6b7280",
    }));

    // Confidence histogram (buckets: 50-59, 60-69, 70-79, 80-89, 90-100)
    const buckets = [
      { range: "50-59", min: 50, max: 59, count: 0 },
      { range: "60-69", min: 60, max: 69, count: 0 },
      { range: "70-79", min: 70, max: 79, count: 0 },
      { range: "80-89", min: 80, max: 89, count: 0 },
      { range: "90-100", min: 90, max: 100, count: 0 },
    ];
    for (const c of allConfidences) {
      if (c.confidence === null) continue;
      const bucket = buckets.find((b) => c.confidence! >= b.min && c.confidence! <= b.max);
      if (bucket) bucket.count++;
    }
    const confidenceBuckets = buckets.map((b) => ({ range: b.range, count: b.count }));

    // Success / failure rate
    const completedCount = jobStatusCounts.find((s) => s.status === "complete")?._count || 0;
    const failedCount = jobStatusCounts.find((s) => s.status === "failed")?._count || 0;
    const totalProcessed = completedCount + failedCount;
    const successRate = totalProcessed > 0 ? (completedCount / totalProcessed) * 100 : 0;
    const failureRate = totalProcessed > 0 ? (failedCount / totalProcessed) * 100 : 0;

    // Weekly trend (last 8 weeks)
    const now = new Date();
    const scanTrends = Array.from({ length: 8 }, (_, i) => {
      const weekStart = new Date(now.getTime() - (7 - i) * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const scans = batchesForTrend.filter(
        (b) => b.createdAt >= weekStart && b.createdAt < weekEnd
      ).length;
      const contacts = contactsForTrend.filter(
        (c) => c.createdAt >= weekStart && c.createdAt < weekEnd
      ).length;
      return {
        label: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        scans,
        contacts,
      };
    });

    return {
      recommendations,
      confidenceBuckets,
      scanTrends,
      successRate,
      failureRate,
      totalJobs: totalProcessed,
    };
  })();

  const stats = [
    {
      label: "Total Scans",
      value: totalScans,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
    },
    {
      label: "Contacts",
      value: contactCount,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      label: "Verified",
      value: jobStats._count,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: "Avg Confidence",
      value: jobStats._avg.confidence
        ? `${Math.round(jobStats._avg.confidence)}%`
        : "--",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ),
    },
  ];

  const statusColors: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    processing: "bg-primary/15 text-primary",
    complete: "bg-success/15 text-success",
    failed: "bg-danger/15 text-danger",
  };

  const recommendationColors: Record<string, string> = {
    HOME: "text-success",
    OFFICE: "text-primary",
    BOTH: "text-accent",
  };

  return (
    <div>
      {/* Welcome */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Welcome back{user ? `, ${user.name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here&apos;s what&apos;s happening with your address lookups.
          </p>
        </div>
        <Link
          href="/dashboard/upload"
          className="bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg font-medium transition text-sm inline-flex items-center gap-2 shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Scan
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="glass-card glass-card-hover rounded-2xl p-5"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                {stat.icon}
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Analytics Charts */}
      <AnalyticsCharts data={analyticsData} />

      {/* Recent Scans */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Recent Scans</h2>
          {batches.length > 0 && (
            <Link
              href="/dashboard/batches"
              className="text-sm text-primary hover:text-primary-hover transition"
            >
              View All
            </Link>
          )}
        </div>

        {batches.length === 0 ? (
          <div className="glass-card rounded-2xl p-12 text-center">
            <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              No scans yet
            </h2>
            <p className="text-muted-foreground text-sm mb-6">
              Upload your first batch of LinkedIn URLs to get started.
            </p>
            <Link
              href="/dashboard/upload"
              className="bg-primary hover:bg-primary-hover text-white px-6 py-2.5 rounded-lg font-medium transition inline-block text-sm"
            >
              Upload LinkedIn URLs
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {batches.map((batch) => {
              const completed = batch.jobs.filter(
                (j) => j.status === "complete"
              ).length;
              const failed = batch.jobs.filter(
                (j) => j.status === "failed"
              ).length;
              const total = batch.jobs.length;
              const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

              return (
                <Link
                  key={batch.id}
                  href={`/dashboard/batches/${batch.id}`}
                  className="block glass-card glass-card-hover rounded-2xl p-5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-foreground font-medium text-sm">
                        {batch.name || `Scan`} &middot; {total} URL{total !== 1 ? "s" : ""}
                      </h3>
                      <p className="text-muted-foreground text-xs mt-1">
                        {new Date(batch.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span
                        className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                          statusColors[batch.status] || statusColors.pending
                        }`}
                      >
                        {batch.status}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {completed}/{total}
                        {failed > 0 && (
                          <span className="text-danger ml-1">({failed} failed)</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {total > 0 && (
                    <div className="mt-3 w-full bg-muted rounded-full h-1.5">
                      <div
                        className="bg-primary h-1.5 rounded-full transition-all duration-700 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Contacts */}
      {recentContacts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Recent Contacts</h2>
            <Link
              href="/dashboard/contacts"
              className="text-sm text-primary hover:text-primary-hover transition"
            >
              View All
            </Link>
          </div>
          <div className="glass-card rounded-2xl divide-y divide-border/50">
            {recentContacts.map((contact) => (
              <Link
                key={contact.id}
                href={`/dashboard/contacts/${contact.id}`}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-card-hover transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                    {contact.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{contact.name}</p>
                    {contact.company && (
                      <p className="text-xs text-muted-foreground">{contact.company}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {contact.recommendation && (
                    <span
                      className={`text-xs font-semibold ${
                        recommendationColors[contact.recommendation] || "text-muted-foreground"
                      }`}
                    >
                      {contact.recommendation}
                    </span>
                  )}
                  {contact.confidence !== null && (
                    <span className="text-xs text-muted-foreground">
                      {contact.confidence}%
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
