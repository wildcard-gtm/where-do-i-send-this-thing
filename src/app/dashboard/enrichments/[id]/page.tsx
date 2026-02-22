"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface ContactInfo {
  id: string;
  name: string;
  linkedinUrl: string;
}

interface Enrichment {
  id: string;
  contactId: string;
  contact: ContactInfo;
  companyName: string;
  enrichmentStatus: string;
  currentStep: string | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

interface EnrichmentBatch {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  enrichments: Enrichment[];
}

const MAX_ATTEMPTS = 5;
const CONCURRENCY = 3;

function StatusBadge({ status, currentStep, errorMessage, retryCount }: {
  status: string;
  currentStep: string | null;
  errorMessage: string | null;
  retryCount: number;
}) {
  if (status === "pending") {
    return (
      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
        Queued
      </span>
    );
  }

  if (status === "enriching") {
    return (
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
        <div>
          <span className="text-xs font-medium text-primary">{currentStep || "Enriching"}</span>
          {retryCount > 1 && (
            <span className="ml-1.5 text-xs text-muted-foreground">attempt {retryCount}/{MAX_ATTEMPTS}</span>
          )}
        </div>
      </div>
    );
  }

  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-success/10 text-success">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Completed
      </span>
    );
  }

  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
        Cancelled
      </span>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-danger/10 text-danger">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Failed
          </span>
          <span className="text-xs text-muted-foreground">
            {retryCount}/{MAX_ATTEMPTS} attempts
          </span>
        </div>
        {errorMessage && (
          <span className="text-xs text-muted-foreground/70 truncate max-w-[240px]" title={errorMessage}>
            {errorMessage}
          </span>
        )}
      </div>
    );
  }

  return (
    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
      {status}
    </span>
  );
}

export default function EnrichmentDetailPage() {
  const params = useParams();
  const batchId = params.id as string;
  const [batch, setBatch] = useState<EnrichmentBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const dispatchingRef = useRef(false);

  const fetchBatch = useCallback(async () => {
    const res = await fetch(`/api/enrichment-batches/${batchId}`);
    if (res.ok) {
      const data = await res.json();
      setBatch(data.batch);
    }
    setLoading(false);
  }, [batchId]);

  useEffect(() => {
    fetchBatch();
  }, [fetchBatch]);

  // Poll every 3s while batch is running
  useEffect(() => {
    if (!batch || batch.status !== "running") return;
    const interval = setInterval(fetchBatch, 3000);
    return () => clearInterval(interval);
  }, [batch, fetchBatch]);

  // Dispatch pending enrichments from the browser with concurrency control
  // This keeps each Vercel function alive for the duration of the enrichment
  const dispatchPending = useCallback(async (enrichmentIds: string[]) => {
    if (dispatchingRef.current || enrichmentIds.length === 0) return;
    dispatchingRef.current = true;

    let idx = 0;
    const runNext = async (): Promise<void> => {
      while (idx < enrichmentIds.length) {
        const enrichmentId = enrichmentIds[idx++];
        try {
          await fetch(`/api/enrichments/${enrichmentId}/run`, { method: "POST" });
        } catch {
          // Individual failure is handled server-side
        }
        fetchBatch();
      }
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, enrichmentIds.length) },
      () => runNext()
    );
    await Promise.allSettled(workers);
    dispatchingRef.current = false;
    fetchBatch();
  }, [fetchBatch]);

  // Auto-dispatch: when batch is running and has pending enrichments not yet being dispatched
  useEffect(() => {
    if (!batch || dispatchingRef.current) return;
    if (batch.status !== "running") return;
    const pendingIds = batch.enrichments
      .filter((e) => e.enrichmentStatus === "pending")
      .map((e) => e.id);
    if (pendingIds.length > 0) {
      dispatchPending(pendingIds);
    }
  }, [batch, dispatchPending]);

  const handleRetryFailed = async () => {
    setRetrying(true);
    setRetryError(null);
    const res = await fetch(`/api/enrichment-batches/${batchId}/retry`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      dispatchingRef.current = false;
      await fetchBatch();
      // Dispatch the reset enrichments
      if (data.enrichmentIds?.length) {
        dispatchPending(data.enrichmentIds);
      }
    } else {
      setRetryError(data.error || "Retry failed");
    }
    setRetrying(false);
  };

  const handleCancel = async () => {
    setCancelling(true);
    await fetch(`/api/enrichment-batches/${batchId}/cancel`, { method: "POST" });
    dispatchingRef.current = false;
    await fetchBatch();
    setCancelling(false);
  };

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
        <p className="text-muted-foreground">Enrichment batch not found.</p>
        <Link href="/dashboard/batches" className="text-primary hover:text-primary-hover mt-4 inline-block">
          Back to Batches
        </Link>
      </div>
    );
  }

  const total = batch.enrichments.length;
  const completed = batch.enrichments.filter((e) => e.enrichmentStatus === "completed").length;
  const failed = batch.enrichments.filter((e) => e.enrichmentStatus === "failed").length;
  const cancelled = batch.enrichments.filter((e) => e.enrichmentStatus === "cancelled").length;
  const running = batch.enrichments.filter((e) => e.enrichmentStatus === "enriching").length;
  const pending = batch.enrichments.filter((e) => e.enrichmentStatus === "pending").length;
  const done = completed + failed + cancelled;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const isRunning = batch.status === "running";
  const canRetry = !isRunning && (failed > 0 || cancelled > 0);

  // Sort: running/pending first, then completed, then failed/cancelled
  const sortedEnrichments = [...batch.enrichments].sort((a, b) => {
    const order: Record<string, number> = { enriching: 0, pending: 1, failed: 2, cancelled: 3, completed: 4 };
    return (order[a.enrichmentStatus] ?? 5) - (order[b.enrichmentStatus] ?? 5);
  });

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">
              {batch.name || "Enrichment"}
            </h1>
            <span
              className={`text-xs font-medium px-3 py-1 rounded-full ${
                batch.status === "running"
                  ? "bg-primary/15 text-primary"
                  : batch.status === "complete"
                  ? "bg-success/15 text-success"
                  : batch.status === "failed"
                  ? "bg-danger/15 text-danger"
                  : batch.status === "cancelled"
                  ? "bg-muted text-muted-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {batch.status === "running" ? "Running"
                : batch.status === "complete" ? "Complete"
                : batch.status === "failed" ? "Failed"
                : batch.status === "cancelled" ? "Cancelled"
                : batch.status}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(batch.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {` · ${total} contact${total !== 1 ? "s" : ""}`}
            {completed > 0 && ` · ${completed} completed`}
            {running > 0 && ` · ${running} running`}
            {pending > 0 && ` · ${pending} queued`}
            {failed > 0 && ` · ${failed} failed`}
            {cancelled > 0 && ` · ${cancelled} cancelled`}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isRunning && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="inline-flex items-center gap-2 bg-muted hover:bg-card text-muted-foreground hover:text-foreground border border-border px-4 py-2 rounded-lg font-medium transition text-sm disabled:opacity-50"
            >
              {cancelling ? (
                <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              Cancel
            </button>
          )}
          {canRetry && (
            <button
              onClick={handleRetryFailed}
              disabled={retrying}
              className="inline-flex items-center gap-2 bg-danger/10 hover:bg-danger/20 text-danger border border-danger/20 px-4 py-2 rounded-lg font-medium transition text-sm disabled:opacity-50"
            >
              {retrying ? (
                <div className="w-4 h-4 border-2 border-danger border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Retry {failed + cancelled} Failed
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

      {retryError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 text-danger text-sm border border-danger/20">
          {retryError}
        </div>
      )}

      {/* Progress bar while running */}
      {isRunning && (
        <div className="glass-card rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-sm text-foreground font-medium">
              {running > 0
                ? `Enriching ${running} contact${running !== 1 ? "s" : ""}${pending > 0 ? `, ${pending} queued` : ""}`
                : pending > 0
                ? `${pending} queued`
                : "Finishing up..."}
            </span>
            <span className="text-sm text-muted-foreground">
              {done}/{total} ({progress}%)
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(progress, 2)}%` }}
            />
          </div>
        </div>
      )}

      {/* Enrichment list */}
      <div className="glass-card rounded-2xl divide-y divide-border/30 overflow-hidden">
        {sortedEnrichments.map((enrichment) => (
          <div key={enrichment.id} className="px-5 py-4 hover:bg-card-hover/50 transition">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                  {enrichment.contact.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/contacts/${enrichment.contactId}`}
                    className="text-sm font-medium text-foreground hover:text-primary transition truncate block"
                  >
                    {enrichment.contact.name}
                  </Link>
                  <p className="text-xs text-muted-foreground truncate">
                    {enrichment.companyName !== "Unknown"
                      ? enrichment.companyName
                      : enrichment.contact.linkedinUrl
                          .replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "")
                          .replace(/\/$/, "")}
                  </p>
                </div>
              </div>

              <div className="shrink-0 sm:ml-4">
                <StatusBadge
                  status={enrichment.enrichmentStatus}
                  currentStep={enrichment.currentStep}
                  errorMessage={enrichment.errorMessage}
                  retryCount={enrichment.retryCount}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
