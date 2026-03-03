"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  archivedAt: string | null;
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

// ─── Stage chip ───────────────────────────────────────────────────────────────

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

  if (total > 0) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
        count >= total
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

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onCancel}>
      <div className="glass-card rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-foreground mb-2">Delete campaign?</h3>
        <p className="text-sm text-muted-foreground mb-5">
          <span className="font-medium text-foreground">{name}</span> and all its contacts, enrichments,
          and postcards will be permanently deleted. This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-danger text-white hover:bg-danger/90 transition"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Campaign row ─────────────────────────────────────────────────────────────

function CampaignRow({
  c,
  archived,
  onClick,
  onArchive,
  onRestore,
  onDelete,
}: {
  c: Campaign;
  archived: boolean;
  onClick: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const scanDone = c.completedJobs + c.failedJobs;
  const scanProgress = c.totalJobs > 0 ? Math.round((scanDone / c.totalJobs) * 100) : 0;
  const isActive =
    c.status === "processing" ||
    c.enrichRunning > 0 ||
    c.postcardRunning > 0;

  const scanStatus =
    c.status === "processing" ? "running"
    : c.status === "complete" ? "complete"
    : c.status === "failed" ? "failed"
    : c.status === "cancelled" ? "cancelled"
    : "pending";

  const enrichLocked = c.completedJobs === 0 && c.enrichBatchId === null;
  const postcardLocked = c.enrichCompleted === 0 && c.postcardBatchId === null;

  return (
    <div className="glass-card rounded-2xl p-5 group/row relative">
      {/* Action buttons — visible on hover */}
      <div
        className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {archived ? (
          <button
            onClick={onRestore}
            title="Restore campaign"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card transition text-xs flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Restore
          </button>
        ) : (
          <button
            onClick={onArchive}
            title="Archive campaign"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card transition text-xs flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            Archive
          </button>
        )}
        <button
          onClick={onDelete}
          title="Delete campaign"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-danger hover:bg-danger/10 transition text-xs flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Delete
        </button>
      </div>

      {/* Clickable body */}
      <div className="cursor-pointer" onClick={onClick}>
        <div className="flex items-start justify-between gap-4 mb-3 pr-28">
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
          <StagePill label="Scan" status={scanStatus} count={c.completedJobs} total={c.totalJobs} locked={false} />
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
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);

  useEffect(() => { document.title = "Campaigns | WDISTT"; }, []);

  const load = useCallback((archived: boolean) => {
    setLoading(true);
    fetch(`/api/campaigns${archived ? "?archived=true" : ""}`)
      .then((r) => (r.ok ? r.json() : { campaigns: [] }))
      .then((data) => {
        setCampaigns(data.campaigns ?? []);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load(tab === "archived");
  }, [tab, load]);

  const activeCount = campaigns.filter(
    (c) => c.status === "processing" || c.enrichRunning > 0 || c.postcardRunning > 0
  ).length;

  async function handleArchive(id: string) {
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleRestore(id: string) {
    await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: false }),
    });
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleDelete(id: string) {
    await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
    setDeleteTarget(null);
  }

  return (
    <div>
      {/* Confirm delete dialog */}
      {deleteTarget && (
        <ConfirmDialog
          name={deleteTarget.name || `Campaign ${formatDate(deleteTarget.createdAt)}`}
          onConfirm={() => handleDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">Campaigns</h1>
            {tab === "active" && activeCount > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold">
                {activeCount}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {tab === "active"
              ? campaigns.length === 0
                ? "Start your first campaign to scan LinkedIn contacts"
                : `${campaigns.length} campaign${campaigns.length !== 1 ? "s" : ""} · Scan → Enrich → Postcard`
              : `${campaigns.length} archived campaign${campaigns.length !== 1 ? "s" : ""}`}
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

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-muted/50 p-1 rounded-xl w-fit">
        {(["active", "archived"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition capitalize ${
              tab === t
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-40">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && campaigns.length === 0 && (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            {tab === "archived" ? (
              <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            ) : (
              <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
            )}
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {tab === "archived" ? "No archived campaigns" : "No campaigns yet"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">
            {tab === "archived"
              ? "Archived campaigns will appear here."
              : "Paste LinkedIn URLs to scan, then enrich contacts and generate postcards — all tracked here."}
          </p>
          {tab === "active" && (
            <Link
              href="/dashboard/upload"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg font-medium transition text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Campaign
            </Link>
          )}
        </div>
      )}

      {/* Campaign list */}
      {!loading && campaigns.length > 0 && (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <CampaignRow
              key={c.id}
              c={c}
              archived={tab === "archived"}
              onClick={() => router.push(`/dashboard/batches/${c.id}`)}
              onArchive={() => handleArchive(c.id)}
              onRestore={() => handleRestore(c.id)}
              onDelete={() => setDeleteTarget(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
