"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface ContactInfo {
  id: string;
  name: string;
  linkedinUrl: string;
}

interface PostcardItem {
  id: string;
  contactId: string;
  contact: ContactInfo;
  contactName: string;
  contactTitle: string | null;
  template: string;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  deliveryAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PostcardBatch {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  postcards: PostcardItem[];
}

const MAX_ATTEMPTS = 5;
const CONCURRENCY = 2; // image gen is slow — keep concurrency low

function StatusBadge({ status, errorMessage, retryCount }: {
  status: string;
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

  if (status === "generating") {
    return (
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
        <div>
          <span className="text-xs font-medium text-primary">Generating</span>
          {retryCount > 1 && (
            <span className="ml-1.5 text-xs text-muted-foreground">attempt {retryCount}/{MAX_ATTEMPTS}</span>
          )}
        </div>
      </div>
    );
  }

  if (status === "ready" || status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-success/10 text-success">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        {status === "approved" ? "Approved" : "Ready"}
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

export default function PostcardBatchDetailPage() {
  const params = useParams();
  const batchId = params.id as string;
  const [batch, setBatch] = useState<PostcardBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const dispatchingRef = useRef(false);

  const fetchBatch = useCallback(async () => {
    const res = await fetch(`/api/postcard-batches/${batchId}`);
    if (res.ok) {
      const data = await res.json();
      setBatch(data.batch);
    }
    setLoading(false);
  }, [batchId]);

  useEffect(() => {
    fetchBatch();
  }, [fetchBatch]);

  // Poll every 4s while batch is running
  useEffect(() => {
    if (!batch || batch.status !== "running") return;
    const interval = setInterval(fetchBatch, 4000);
    return () => clearInterval(interval);
  }, [batch, fetchBatch]);

  // Dispatch pending postcards from the browser with concurrency control.
  // This keeps each Vercel function alive for the duration of the generation.
  const dispatchPending = useCallback(async (postcardIds: string[]) => {
    if (dispatchingRef.current || postcardIds.length === 0) return;
    dispatchingRef.current = true;

    let idx = 0;
    const runNext = async (): Promise<void> => {
      while (idx < postcardIds.length) {
        const postcardId = postcardIds[idx++];
        try {
          await fetch(`/api/postcards/${postcardId}/run`, { method: "POST" });
        } catch {
          // Individual failure handled server-side
        }
        fetchBatch();
      }
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, postcardIds.length) },
      () => runNext()
    );
    await Promise.allSettled(workers);
    dispatchingRef.current = false;
    fetchBatch();
  }, [fetchBatch]);

  // Auto-dispatch: when batch is running and has pending postcards
  useEffect(() => {
    if (!batch || dispatchingRef.current) return;
    if (batch.status !== "running") return;
    const pendingIds = batch.postcards
      .filter((p) => p.status === "pending")
      .map((p) => p.id);
    if (pendingIds.length > 0) {
      dispatchPending(pendingIds);
    }
  }, [batch, dispatchPending]);

  const handleRetryFailed = async () => {
    setRetrying(true);
    setRetryError(null);
    const res = await fetch(`/api/postcard-batches/${batchId}/retry`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      dispatchingRef.current = false;
      await fetchBatch();
      if (data.postcardIds?.length) {
        dispatchPending(data.postcardIds);
      }
    } else {
      setRetryError(data.error || "Retry failed");
    }
    setRetrying(false);
  };

  const handleCancel = async () => {
    setCancelling(true);
    await fetch(`/api/postcard-batches/${batchId}/cancel`, { method: "POST" });
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
        <p className="text-muted-foreground">Postcard batch not found.</p>
        <Link href="/dashboard/postcards" className="text-primary hover:text-primary-hover mt-4 inline-block">
          Back to Postcards
        </Link>
      </div>
    );
  }

  const total = batch.postcards.length;
  const ready = batch.postcards.filter((p) => p.status === "ready" || p.status === "approved").length;
  const failed = batch.postcards.filter((p) => p.status === "failed").length;
  const cancelled = batch.postcards.filter((p) => p.status === "cancelled").length;
  const generating = batch.postcards.filter((p) => p.status === "generating").length;
  const pending = batch.postcards.filter((p) => p.status === "pending").length;
  const done = ready + failed + cancelled;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const isRunning = batch.status === "running";
  const canRetry = !isRunning && (failed > 0 || cancelled > 0);

  // Sort: generating/pending first, then failed, then cancelled, then ready/approved
  const sortedPostcards = [...batch.postcards].sort((a, b) => {
    const order: Record<string, number> = { generating: 0, pending: 1, failed: 2, cancelled: 3, ready: 4, approved: 5 };
    return (order[a.status] ?? 6) - (order[b.status] ?? 6);
  });

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">
              {batch.name || "Postcards"}
            </h1>
            <span
              className={`text-xs font-medium px-3 py-1 rounded-full ${
                batch.status === "running"
                  ? "bg-primary/15 text-primary"
                  : batch.status === "complete"
                  ? "bg-success/15 text-success"
                  : batch.status === "failed"
                  ? "bg-danger/15 text-danger"
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
            {` · ${total} postcard${total !== 1 ? "s" : ""}`}
            {ready > 0 && ` · ${ready} ready`}
            {generating > 0 && ` · ${generating} generating`}
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
              Stop
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
          {!isRunning && ready > 0 && (
            <Link
              href="/dashboard/postcards"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg font-medium transition text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              View Postcards
            </Link>
          )}
          <Link
            href="/dashboard/postcards"
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
              {generating > 0
                ? `Generating ${generating} postcard${generating !== 1 ? "s" : ""}${pending > 0 ? `, ${pending} queued` : ""}`
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

      {/* Postcard list */}
      <div className="glass-card rounded-2xl divide-y divide-border/30 overflow-hidden">
        {sortedPostcards.map((postcard) => (
          <div key={postcard.id} className="px-5 py-4 hover:bg-card-hover/50 transition">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                  {postcard.contactName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/contacts/${postcard.contactId}`}
                    className="text-sm font-medium text-foreground hover:text-primary transition truncate block"
                  >
                    {postcard.contactName}
                  </Link>
                  <p className="text-xs text-muted-foreground truncate">
                    {postcard.contactTitle || postcard.contact.linkedinUrl
                      .replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "")
                      .replace(/\/$/, "")}
                    {" · "}
                    <span className="capitalize">{postcard.template}</span>
                    {postcard.deliveryAddress && ` · ${postcard.deliveryAddress}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0 sm:ml-4">
                <StatusBadge
                  status={postcard.status}
                  errorMessage={postcard.errorMessage}
                  retryCount={postcard.retryCount}
                />
                {(postcard.status === "ready" || postcard.status === "approved") && (
                  <Link
                    href={`/dashboard/postcards/${postcard.id}`}
                    className="text-xs text-primary hover:text-primary-hover font-medium transition"
                  >
                    View
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
