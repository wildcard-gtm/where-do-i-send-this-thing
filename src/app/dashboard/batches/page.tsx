"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  // Scan stage
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  // Enrich stage
  enrichBatchId: string | null;
  enrichStatus: string | null;
  enrichTotal: number;
  enrichCompleted: number;
  enrichFailed: number;
  enrichRunning: number;
  // Postcard stage
  postcardBatchId: string | null;
  postcardStatus: string | null;
  postcardTotal: number;
  postcardReady: number;
  postcardFailed: number;
  postcardRunning: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Stage chip: shows scan / enrich / postcard status inline ────────────────

function StagePill({
  label,
  status,
  count,
  total,
  locked,
}: {
  label: string;
  status: string | null;
  count: number;
  total: number;
  locked: boolean;
}) {
  if (locked) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-muted/50 text-muted-foreground/50 border border-border/30">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        {label}
      </span>
    );
  }

  if (status === "running" || status === "processing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
        {label} {count}/{total}
      </span>
    );
  }

  if (status === "complete" || status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-success/10 text-success border border-success/20">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        {label}
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-danger/10 text-danger border border-danger/20">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
        {label} {count}/{total}
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border/50">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" strokeWidth={2} />
        </svg>
        {label} {count}/{total}
      </span>
    );
  }

  // Has data but no clear status — partial/complete
  if (total > 0) {
    const allDone = count + (status === "failed" ? 0 : 0) >= total;
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
        allDone
          ? "bg-success/10 text-success border-success/20"
          : "bg-muted text-muted-foreground border-border/50"
      }`}>
        {label} {count}/{total}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-muted/50 text-muted-foreground/50 border border-border/30">
      {label}
    </span>
  );
}

// ─── Campaign row ─────────────────────────────────────────────────────────────

function CampaignRow({ c, onClick }: { c: Campaign; onClick: () => void }) {
  const scanDone = c.completedJobs + c.failedJobs;
  const scanProgress = c.totalJobs > 0 ? Math.round((scanDone / c.totalJobs) * 100) : 0;
  const isActive =
    c.status === "processing" ||
    c.enrichRunning > 0 ||
    c.postcardRunning > 0;

  // Derive scan stage status
  const scanStatus =
    c.status === "processing" ? "running"
    : c.status === "complete" ? "complete"
    : c.status === "failed" ? "failed"
    : c.status === "cancelled" ? "cancelled"
    : "pending";

  // Enrich is locked if scan has 0 completions
  const enrichLocked = c.completedJobs === 0 && c.enrichBatchId === null;

  // Postcard is locked if no enrichment completed
  const postcardLocked = c.enrichCompleted === 0 && c.postcardBatchId === null;

  return (
    <div
      className="glass-card glass-card-hover rounded-2xl p-5 cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isActive && (
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
            )}
            <p className="text-sm font-semibold text-foreground truncate">
              {c.name || `Campaign ${formatDate(c.createdAt)}`}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDate(c.createdAt)} · {c.totalJobs} lead{c.totalJobs !== 1 ? "s" : ""}
          </p>
        </div>
        <svg className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* 3-stage pills */}
      <div className="flex flex-wrap gap-2">
        <StagePill
          label="Scan"
          status={scanStatus}
          count={c.completedJobs}
          total={c.totalJobs}
          locked={false}
        />
        <StagePill
          label="Enrich"
          status={enrichLocked ? null : (c.enrichStatus ?? (c.enrichBatchId ? "pending" : null))}
          count={c.enrichCompleted}
          total={c.enrichTotal}
          locked={enrichLocked}
        />
        <StagePill
          label="Postcard"
          status={postcardLocked ? null : (c.postcardStatus ?? (c.postcardBatchId ? "pending" : null))}
          count={c.postcardReady}
          total={c.postcardTotal}
          locked={postcardLocked}
        />
      </div>

      {/* Progress bar — only when scan is running */}
      {c.status === "processing" && c.totalJobs > 0 && (
        <div className="mt-3 w-full bg-muted rounded-full h-1">
          <div className="bg-primary h-1 rounded-full transition-all" style={{ width: `${scanProgress}%` }} />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => (r.ok ? r.json() : { campaigns: [] }))
      .then((data) => {
        setCampaigns(data.campaigns ?? []);
        setLoading(false);
      });
  }, []);

  const activeCount = campaigns.filter(
    (c) =>
      c.status === "processing" ||
      c.enrichRunning > 0 ||
      c.postcardRunning > 0
  ).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">Campaigns</h1>
            {activeCount > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold">
                {activeCount}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {campaigns.length === 0
              ? "Start your first campaign to scan LinkedIn contacts"
              : `${campaigns.length} campaign${campaigns.length !== 1 ? "s" : ""} · Scan → Enrich → Postcard`}
          </p>
        </div>
        <Link
          href="/dashboard/upload"
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2.5 rounded-lg font-medium transition text-sm shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Campaign
        </Link>
      </div>

      {/* Empty state */}
      {campaigns.length === 0 && (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">No campaigns yet</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">
            Paste LinkedIn URLs to scan, then enrich contacts and generate postcards — all tracked here.
          </p>
          <Link
            href="/dashboard/upload"
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg font-medium transition text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Campaign
          </Link>
        </div>
      )}

      {/* Campaign list */}
      {campaigns.length > 0 && (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <CampaignRow
              key={c.id}
              c={c}
              onClick={() => router.push(`/dashboard/batches/${c.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
