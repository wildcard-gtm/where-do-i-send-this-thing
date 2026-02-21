"use client";

import { useEffect, useState, useCallback } from "react";
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

function StatusBadge({ status, currentStep, errorMessage, retryCount }: {
  status: string;
  currentStep: string | null;
  errorMessage: string | null;
  retryCount: number;
}) {
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
  const [retryError, setRetryError] = useState<string | null>(null);

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

  // Poll every 3s while batch is still running
  useEffect(() => {
    if (!batch || batch.status !== "running") return;
    const interval = setInterval(fetchBatch, 3000);
    return () => clearInterval(interval);
  }, [batch, fetchBatch]);

  const handleRetryFailed = async () => {
    setRetrying(true);
    setRetryError(null);
    const res = await fetch(`/api/enrichment-batches/${batchId}/retry`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      await fetchBatch();
    } else {
      setRetryError(data.error || "Retry failed");
    }
    setRetrying(false);
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
        <Link href="/dashboard/enrichments" className="text-primary hover:text-primary-hover mt-4 inline-block">
          Back to Enrichments
        </Link>
      </div>
    );
  }

  const total = batch.enrichments.length;
  const completed = batch.enrichments.filter((e) => e.enrichmentStatus === "completed").length;
  const failed = batch.enrichments.filter((e) => e.enrichmentStatus === "failed").length;
  const running = batch.enrichments.filter((e) => e.enrichmentStatus === "enriching").length;
  const done = completed + failed;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  // Show retry button when batch is done but has failures
  const canRetry = batch.status !== "running" && failed > 0;

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
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {batch.status === "running" ? "Running" : batch.status === "complete" ? "Complete" : batch.status === "failed" ? "Failed" : batch.status}
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
            {failed > 0 && ` · ${failed} failed`}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
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
              Retry {failed} Failed
            </button>
          )}
          <Link
            href="/dashboard/enrichments"
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
      {batch.status === "running" && (
        <div className="glass-card rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-sm text-foreground font-medium">
              {running > 0
                ? `Enriching ${running} contact${running !== 1 ? "s" : ""}`
                : "Processing..."}
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
        {batch.enrichments.map((enrichment) => (
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
                    {enrichment.companyName !== "Unknown" ? enrichment.companyName : enrichment.contact.linkedinUrl.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "")}
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
