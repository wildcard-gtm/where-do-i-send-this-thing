"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface StageEvent {
  type: string;
  toolName: string | null;
}

interface Job {
  id: string;
  linkedinUrl: string;
  personName: string | null;
  status: string;
  recommendation: string | null;
  confidence: number | null;
  createdAt: string;
  contactId: string | null;
  stages?: StageEvent[];
}

interface Batch {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  jobs: Job[];
}

// ─── Stage definitions (short, professional labels) ─────

const LEAD_STAGES = [
  { key: "profile", tools: ["enrich_linkedin_profile"], label: "Analyzing" },
  { key: "search", tools: ["search_web"], label: "Searching" },
  { key: "address", tools: ["search_person_address"], label: "Locating" },
  { key: "verify", tools: ["verify_property", "calculate_distance"], label: "Verifying" },
  { key: "decision", tools: ["submit_decision"], label: "Finalizing" },
];

function getJobProgress(stages: StageEvent[] | undefined, status: string) {
  const completed = new Set<string>();
  let currentKey: string | null = null;
  let currentLabel = "Queued";

  if (status === "complete") {
    LEAD_STAGES.forEach((s) => completed.add(s.key));
    return { completed, currentKey: null, currentLabel: "Complete", pct: 100 };
  }
  if (status === "failed") return { completed, currentKey: null, currentLabel: "Failed", pct: 0 };
  if (status === "cancelled") return { completed, currentKey: null, currentLabel: "Cancelled", pct: 0 };
  if (status === "pending") return { completed, currentKey: null, currentLabel: "Queued", pct: 0 };

  if (!stages || stages.length === 0) {
    return { completed, currentKey: "profile", currentLabel: "Starting", pct: 5 };
  }

  for (const event of stages) {
    if (event.type === "tool_call_result" && event.toolName) {
      for (const stage of LEAD_STAGES) {
        if (stage.tools.includes(event.toolName)) completed.add(stage.key);
      }
    }
    if (event.type === "tool_call_start" && event.toolName) {
      for (const stage of LEAD_STAGES) {
        if (stage.tools.includes(event.toolName) && !completed.has(stage.key)) {
          currentKey = stage.key;
          currentLabel = stage.label;
        }
      }
    }
    if (event.type === "decision_accepted" || event.type === "complete") {
      completed.add("decision");
      currentKey = null;
      currentLabel = "Complete";
    }
    if (event.type === "error") {
      currentKey = null;
      currentLabel = "Failed";
    }
  }

  if (status === "running" && !currentKey) {
    for (const stage of LEAD_STAGES) {
      if (!completed.has(stage.key)) {
        currentKey = stage.key;
        currentLabel = stage.label;
        break;
      }
    }
  }

  const pct = Math.round((completed.size / LEAD_STAGES.length) * 100);
  return { completed, currentKey, currentLabel, pct };
}

// ─── Stage icon SVGs ────────────────────────────────────

function StageIcon({ stageKey }: { stageKey: string }) {
  const cls = "w-3.5 h-3.5";
  switch (stageKey) {
    case "profile":
      return (<svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>);
    case "search":
      return (<svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>);
    case "address":
      return (<svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>);
    case "verify":
      return (<svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>);
    case "decision":
      return (<svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>);
    default:
      return (<svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" strokeWidth={2} /></svg>);
  }
}

// ─── Per-lead inline status ─────────────────────────────

function LeadStatus({ job, onRetry }: { job: Job; onRetry: (jobId: string) => void }) {
  const { currentKey, currentLabel, pct } = getJobProgress(job.stages, job.status);

  if (job.status === "pending") {
    return (
      <span className="text-xs text-muted-foreground px-2.5 py-1 rounded-full bg-muted">
        Queued
      </span>
    );
  }

  if (job.status === "cancelled") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          Cancelled
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRetry(job.id); }}
          className="text-xs font-medium text-primary hover:text-primary-hover transition flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Retry
        </button>
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-danger bg-danger/10 px-2.5 py-1 rounded-full">
          Failed
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onRetry(job.id); }}
          className="text-xs font-medium text-primary hover:text-primary-hover transition flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Retry
        </button>
      </div>
    );
  }

  if (job.status === "complete") {
    const recCfg: Record<string, { cls: string; icon: React.ReactNode }> = {
      HOME: {
        cls: "text-success bg-success/10",
        icon: (<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>),
      },
      OFFICE: {
        cls: "text-primary bg-primary/10",
        icon: (<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>),
      },
      BOTH: {
        cls: "text-accent bg-accent/10",
        icon: (<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>),
      },
    };

    const cfg = job.recommendation ? recCfg[job.recommendation] : null;

    return (
      <div className="flex items-center gap-3">
        {cfg && job.recommendation && (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.cls}`}>
            {cfg.icon}
            {job.recommendation}
          </span>
        )}
        {job.confidence !== null && (
          <span className={`text-xs font-medium ${
            job.confidence >= 85 ? "text-success" : job.confidence >= 75 ? "text-primary" : "text-warning"
          }`}>
            {job.confidence}%
          </span>
        )}
        {job.contactId ? (
          <a
            href={`/dashboard/contacts/${job.contactId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-medium text-primary hover:text-primary-hover transition flex items-center gap-1"
          >
            View Contact
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ) : !job.recommendation ? (
          <span className="text-xs text-muted-foreground">No result</span>
        ) : null}
      </div>
    );
  }

  // Running
  return (
    <div className="flex items-center gap-2.5 min-w-[180px]">
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center animate-pulse">
          {currentKey ? <StageIcon stageKey={currentKey} /> : (
            <div className="w-3 h-3 border-[1.5px] border-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>
        <span className="text-xs font-medium text-primary whitespace-nowrap">
          {currentLabel}
        </span>
      </div>
      <div className="flex-1 bg-muted rounded-full h-1.5 min-w-[50px]">
        <div
          className="bg-primary h-1.5 rounded-full transition-all duration-700 ease-out"
          style={{ width: `${Math.max(pct, 8)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────

const CONCURRENCY = 5;

export default function BatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.id as string;
  const [batch, setBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const dispatchingRef = useRef(false);

  // Reset dispatching ref when batchId changes (navigating between batches)
  useEffect(() => {
    dispatchingRef.current = false;
  }, [batchId]);

  const fetchBatch = useCallback(async () => {
    const res = await fetch(`/api/batches/${batchId}`);
    if (res.ok) {
      const data = await res.json();
      setBatch(data.batch);
    }
    setLoading(false);
  }, [batchId]);

  useEffect(() => {
    fetchBatch();
    const interval = setInterval(fetchBatch, 3000);
    return () => clearInterval(interval);
  }, [fetchBatch]);

  // Auto-dispatch: if batch is "processing" but all jobs are still "pending"
  // (no running/complete/failed jobs), kick off dispatching
  useEffect(() => {
    if (!batch || dispatchingRef.current) return;
    if (batch.status !== "processing") return;
    const pendingJobs = batch.jobs.filter((j) => j.status === "pending");
    const hasActive = batch.jobs.some(
      (j) => j.status === "running" || j.status === "complete" || j.status === "failed"
    );
    // Only auto-dispatch if ALL jobs are pending (fresh batch)
    if (pendingJobs.length > 0 && pendingJobs.length === batch.jobs.length && !hasActive) {
      dispatchJobs(pendingJobs.map((j) => j.id));
    }
  }, [batch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dispatch jobs via individual SSE streams with concurrency control
  async function dispatchJobs(jobIds: string[]) {
    if (dispatchingRef.current) return;
    dispatchingRef.current = true;

    let idx = 0;
    const runNext = async (): Promise<void> => {
      while (idx < jobIds.length) {
        const jobId = jobIds[idx++];
        try {
          // Open SSE stream — this triggers the job to run server-side
          // We just need to consume the stream to keep the connection alive
          const res = await fetch(`/api/batches/${batchId}/jobs/${jobId}/stream`);
          if (!res.ok || !res.body) continue;
          const reader = res.body.getReader();
          // Consume the stream until done
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        } catch {
          // Job stream failed, continue to next
        }
        // Refresh UI after each job completes
        fetchBatch();
      }
    };

    // Start concurrent workers
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, jobIds.length) },
      () => runNext()
    );
    await Promise.allSettled(workers);

    // Finalize batch status
    try {
      await fetch(`/api/batches/${batchId}/finalize`, { method: "POST" });
    } catch {
      // Best effort
    }

    dispatchingRef.current = false;
    fetchBatch();
  }

  async function handleStart() {
    setStarting(true);
    const res = await fetch(`/api/batches/${batchId}/start`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      fetchBatch();
      setStarting(false);
      // Dispatch jobs in background (don't await — let them run)
      if (data.jobIds?.length > 0) {
        dispatchJobs(data.jobIds);
      }
    } else {
      setStarting(false);
    }
  }

  async function handleStop() {
    setStopping(true);
    const res = await fetch(`/api/batches/${batchId}/stop`, { method: "POST" });
    if (res.ok) fetchBatch();
    setStopping(false);
  }

  async function handleRestart() {
    setRestarting(true);
    const res = await fetch(`/api/batches/${batchId}/restart`, { method: "POST" });
    if (res.ok) fetchBatch();
    setRestarting(false);
  }

  async function handleRetry(jobId: string) {
    const res = await fetch(`/api/batches/${batchId}/jobs/${jobId}/retry`, { method: "POST" });
    if (res.ok) {
      fetchBatch();
      dispatchJobs([jobId]);
    }
  }

  async function handleRetryAllFailed() {
    if (!batch) return;
    const res = await fetch(`/api/batches/${batchId}/retry-failed`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      fetchBatch();
      if (data.jobIds?.length > 0) {
        dispatchJobs(data.jobIds);
      }
    }
  }

  async function handleEnrichContacts() {
    if (!batch) return;
    const completedContactIds = batch.jobs
      .filter((j) => j.status === "complete" && j.contactId)
      .map((j) => j.contactId as string);
    if (completedContactIds.length === 0) return;
    setEnriching(true);
    const res = await fetch("/api/contacts/enrich-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: completedContactIds }),
    });
    const data = await res.json();
    if (res.ok && data.enrichmentBatchId) {
      router.push(`/dashboard/enrichments/${data.enrichmentBatchId}`);
    } else {
      setEnriching(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Batch not found.</p>
        <button onClick={() => router.push("/dashboard/batches")} className="text-primary hover:text-primary-hover mt-4">
          Back to Batches
        </button>
      </div>
    );
  }

  const completed = batch.jobs.filter((j) => j.status === "complete").length;
  const failed = batch.jobs.filter((j) => j.status === "failed").length;
  const cancelled = batch.jobs.filter((j) => j.status === "cancelled").length;
  const running = batch.jobs.filter((j) => j.status === "running").length;
  const total = batch.jobs.length;
  const done = completed + failed + cancelled;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const isStopped = batch.status === "cancelled" || batch.status === "failed" || batch.status === "complete";
  const hasRetryableJobs = failed > 0 || cancelled > 0;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">
              {batch.name || "Scan"}
            </h1>
            <span className={`text-xs font-medium px-3 py-1 rounded-full ${
              batch.status === "processing" ? "bg-primary/15 text-primary" :
              batch.status === "complete" ? "bg-success/15 text-success" :
              batch.status === "cancelled" ? "bg-muted text-muted-foreground" :
              batch.status === "failed" ? "bg-danger/15 text-danger" :
              "bg-muted text-muted-foreground"
            }`}>
              {batch.status === "processing" ? "Processing" :
               batch.status === "complete" ? "Complete" :
               batch.status === "cancelled" ? "Cancelled" :
               batch.status === "failed" ? "Failed" :
               "Pending"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(batch.createdAt).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
            })}
            {" \u00b7 "}{total} lead{total !== 1 ? "s" : ""}
            {completed > 0 && ` \u00b7 ${completed} found`}
            {running > 0 && ` \u00b7 ${running} running`}
            {failed > 0 && ` \u00b7 ${failed} failed`}
            {cancelled > 0 && ` \u00b7 ${cancelled} cancelled`}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {/* Start Scan — only when pending */}
          {batch.status === "pending" && (
            <button
              onClick={handleStart}
              disabled={starting}
              className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition text-sm"
            >
              {starting ? "Starting..." : "Start Scan"}
            </button>
          )}

          {/* Stop — only when processing */}
          {batch.status === "processing" && (
            <button
              onClick={handleStop}
              disabled={stopping}
              className="bg-danger hover:opacity-90 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition text-sm inline-flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
              {stopping ? "Stopping..." : "Stop"}
            </button>
          )}

          {/* Retry Failed/Cancelled — only when there are retryable jobs and batch is not processing */}
          {isStopped && hasRetryableJobs && (
            <button
              onClick={handleRetryAllFailed}
              className="bg-primary hover:bg-primary-hover text-white px-5 py-2 rounded-lg font-medium transition text-sm inline-flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {failed > 0 && cancelled > 0 ? "Retry All" : failed > 0 ? "Retry Failed" : "Retry Cancelled"}
            </button>
          )}

          {/* Start Over — only when batch is done/failed/cancelled */}
          {isStopped && (
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="border border-border hover:border-primary text-foreground hover:text-primary px-5 py-2 rounded-lg font-medium transition text-sm inline-flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {restarting ? "Resetting..." : "Start Over"}
            </button>
          )}

          {/* Export CSV — when there are completed jobs */}
          {completed > 0 && isStopped && (
            <a
              href={`/api/batches/${batchId}/export`}
              className="border border-border hover:border-muted-foreground text-muted-foreground hover:text-foreground px-5 py-2 rounded-lg font-medium transition text-sm inline-flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </a>
          )}

          {/* Enrich Contacts — primary CTA when scan is done */}
          {completed > 0 && isStopped && (
            <button
              onClick={handleEnrichContacts}
              disabled={enriching}
              className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition text-sm inline-flex items-center gap-1.5"
            >
              {enriching ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              {enriching ? "Starting..." : `Enrich ${completed} Contact${completed !== 1 ? "s" : ""} →`}
            </button>
          )}

          <Link
            href="/dashboard/batches"
            className="border border-border hover:border-muted-foreground text-muted-foreground hover:text-foreground px-5 py-2 rounded-lg font-medium transition text-sm"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Overall Progress Bar (only during processing) */}
      {batch.status === "processing" && (
        <div className="glass-card rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-sm text-foreground font-medium">
              Scanning {running > 1 ? `${running} leads in parallel` : running === 1 ? "1 lead" : "leads"}
            </span>
            <span className="text-sm text-muted-foreground">
              {done}/{total} ({progress}%)
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Leads List */}
      <div className="glass-card rounded-2xl divide-y divide-border/30 overflow-hidden">
        {[...batch.jobs].sort((a, b) => {
          const order: Record<string, number> = { running: 0, pending: 1, failed: 2, cancelled: 3, complete: 4 };
          return (order[a.status] ?? 5) - (order[b.status] ?? 5);
        }).map((job) => (
          <div key={job.id} className="px-5 py-4 hover:bg-card-hover/50 transition">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                  {(job.personName || job.linkedinUrl.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, ""))[0]?.toUpperCase() || "?"}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {job.personName || formatLinkedinSlug(job.linkedinUrl)}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {job.linkedinUrl.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "")}
                  </p>
                </div>
              </div>

              <div className="shrink-0 sm:ml-4">
                <LeadStatus job={job} onRetry={handleRetry} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatLinkedinSlug(url: string): string {
  const slug = url.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "");
  const parts = slug.split("-");
  // Remove trailing parts that look like LinkedIn ID suffixes (hex/numeric strings like "bb53241", "96a603242")
  while (parts.length > 1 && /^[0-9a-f]+$/i.test(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
