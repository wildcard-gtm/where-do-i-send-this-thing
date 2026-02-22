"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScanBatch {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  jobs: { status: string }[];
}

interface EnrichBatch {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  total: number;
  completed: number;
  failed: number;
  running: number;
}

interface PostcardBatch {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  total: number;
  ready: number;
  failed: number;
  generating: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    pending:    "bg-muted text-muted-foreground",
    processing: "bg-primary/15 text-primary",
    running:    "bg-primary/15 text-primary",
    complete:   "bg-success/15 text-success",
    completed:  "bg-success/15 text-success",
    failed:     "bg-danger/15 text-danger",
    cancelled:  "bg-muted text-muted-foreground",
  };
  const label: Record<string, string> = {
    pending: "Pending", processing: "Running", running: "Running",
    complete: "Complete", completed: "Complete",
    failed: "Failed", cancelled: "Cancelled",
  };
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${cfg[status] ?? "bg-muted text-muted-foreground"}`}>
      {label[status] ?? status}
    </span>
  );
}

// ─── Sub-lists ───────────────────────────────────────────────────────────────

function ScansList({ batches }: { batches: ScanBatch[] }) {
  const router = useRouter();
  if (batches.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-10 text-center">
        <p className="text-muted-foreground text-sm mb-4">No scans yet.</p>
        <Link href="/dashboard/upload" className="bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg font-medium transition text-sm inline-block">
          New Scan
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {batches.map((b) => {
        const completed = b.jobs.filter((j) => j.status === "complete").length;
        const total = b.jobs.length;
        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
        return (
          <div
            key={b.id}
            className="glass-card glass-card-hover rounded-2xl p-4 cursor-pointer"
            onClick={() => router.push(`/dashboard/batches/${b.id}`)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {b.name || "Scan"} <span className="text-muted-foreground font-normal">· {total} lead{total !== 1 ? "s" : ""}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(b.createdAt)}</p>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="text-xs text-muted-foreground">{completed}/{total}</span>
                <StatusPill status={b.status} />
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
            {total > 0 && (
              <div className="mt-3 w-full bg-muted rounded-full h-1">
                <div className="bg-primary h-1 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EnrichList({ batches }: { batches: EnrichBatch[] }) {
  const router = useRouter();
  if (batches.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-10 text-center">
        <p className="text-muted-foreground text-sm">No enrichment runs yet. Complete a scan first.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {batches.map((b) => {
        const done = b.completed + b.failed;
        const progress = b.total > 0 ? Math.round((done / b.total) * 100) : 0;
        return (
          <div
            key={b.id}
            className="glass-card glass-card-hover rounded-2xl p-4 cursor-pointer"
            onClick={() => router.push(`/dashboard/enrichments/${b.id}`)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {b.name || "Enrichment"} <span className="text-muted-foreground font-normal">· {b.total} contact{b.total !== 1 ? "s" : ""}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(b.createdAt)}</p>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="text-xs text-muted-foreground">{b.completed}/{b.total}</span>
                <StatusPill status={b.status} />
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
            {b.total > 0 && (
              <div className="mt-3 w-full bg-muted rounded-full h-1">
                <div className="bg-primary h-1 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PostcardList({ batches }: { batches: PostcardBatch[] }) {
  const router = useRouter();
  if (batches.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-10 text-center">
        <p className="text-muted-foreground text-sm">No postcard runs yet. Complete enrichment first.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {batches.map((b) => {
        const done = b.ready + b.failed;
        const progress = b.total > 0 ? Math.round((done / b.total) * 100) : 0;
        return (
          <div
            key={b.id}
            className="glass-card glass-card-hover rounded-2xl p-4 cursor-pointer"
            onClick={() => router.push(`/dashboard/postcards/batches/${b.id}`)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {b.name || "Postcards"} <span className="text-muted-foreground font-normal">· {b.total} postcard{b.total !== 1 ? "s" : ""}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(b.createdAt)}</p>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="text-xs text-muted-foreground">{b.ready}/{b.total} ready</span>
                <StatusPill status={b.status} />
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
            {b.total > 0 && (
              <div className="mt-3 w-full bg-muted rounded-full h-1">
                <div className="bg-primary h-1 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

const TABS = [
  { key: "scans",      label: "Scans" },
  { key: "enrich",     label: "Enrichments" },
  { key: "postcards",  label: "Postcards" },
] as const;
type TabKey = typeof TABS[number]["key"];

export default function BatchesPage() {
  const [tab, setTab] = useState<TabKey>("scans");
  const [scanBatches, setScanBatches] = useState<ScanBatch[]>([]);
  const [enrichBatches, setEnrichBatches] = useState<EnrichBatch[]>([]);
  const [postcardBatches, setPostcardBatches] = useState<PostcardBatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/batches").then((r) => r.ok ? r.json() : { batches: [] }),
      fetch("/api/enrichment-batches").then((r) => r.ok ? r.json() : { batches: [] }),
      fetch("/api/postcard-batches").then((r) => r.ok ? r.json() : { batches: [] }),
    ]).then(([scans, enrichs, postcards]) => {
      setScanBatches(scans.batches ?? []);
      setEnrichBatches(enrichs.batches ?? []);
      setPostcardBatches(postcards.batches ?? []);
      setLoading(false);
    });
  }, []);

  const activeCount: Record<TabKey, number> = {
    scans:     scanBatches.filter((b) => b.status === "processing").length,
    enrich:    enrichBatches.filter((b) => b.status === "running").length,
    postcards: postcardBatches.filter((b) => b.status === "running").length,
  };

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
          <h1 className="text-2xl font-bold text-foreground">Batches</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track every scan, enrichment, and postcard run end-to-end
          </p>
        </div>
        <Link
          href="/dashboard/upload"
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2.5 rounded-lg font-medium transition text-sm shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Scan
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border/50 pb-0">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`relative px-5 py-2.5 text-sm font-medium transition rounded-t-lg ${
              tab === key
                ? "text-primary bg-primary/8"
                : "text-muted-foreground hover:text-foreground hover:bg-card"
            }`}
          >
            {label}
            {activeCount[key] > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold">
                {activeCount[key]}
              </span>
            )}
            {tab === key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "scans"     && <ScansList batches={scanBatches} />}
      {tab === "enrich"    && <EnrichList batches={enrichBatches} />}
      {tab === "postcards" && <PostcardList batches={postcardBatches} />}
    </div>
  );
}
