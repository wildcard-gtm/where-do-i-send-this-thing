"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface EnrichmentBatch {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  total: number;
  completed: number;
  failed: number;
  running: number;
}

const statusColors: Record<string, string> = {
  running: "bg-primary/15 text-primary",
  complete: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
};

const statusTabs = ["all", "running", "complete", "failed"];

export default function EnrichmentsPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<EnrichmentBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch("/api/enrichment-batches")
      .then((res) => (res.ok ? res.json() : { batches: [] }))
      .then((data) => {
        setBatches(data.batches || []);
        setLoading(false);
      });
  }, []);

  const filtered = batches.filter((b) => {
    if (filter !== "all" && b.status !== filter) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <h1 className="text-2xl font-bold text-foreground">Enrichments</h1>
        <Link
          href="/dashboard/contacts"
          className="bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-lg font-medium transition text-sm inline-flex items-center gap-2 shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Enrich Contacts
        </Link>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto">
        {statusTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition capitalize whitespace-nowrap ${
              filter === tab
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-card"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Batch list */}
      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">No enrichments yet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Select contacts and click &ldquo;Enrich&rdquo; to start a new enrichment run.
          </p>
          <Link
            href="/dashboard/contacts"
            className="bg-primary hover:bg-primary-hover text-white px-6 py-2.5 rounded-lg font-medium transition inline-block text-sm"
          >
            Go to Contacts
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((batch) => {
            const progress =
              batch.total > 0 ? Math.round(((batch.completed + batch.failed) / batch.total) * 100) : 0;

            return (
              <div
                key={batch.id}
                className="glass-card glass-card-hover rounded-2xl p-5 cursor-pointer"
                onClick={() => router.push(`/dashboard/enrichments/${batch.id}`)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-foreground font-medium text-sm">
                      {batch.name || "Enrichment"} &middot; {batch.total} contact{batch.total !== 1 ? "s" : ""}
                    </h3>
                    <p className="text-muted-foreground text-xs mt-1">
                      {new Date(batch.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {batch.completed > 0 && ` · ${batch.completed} completed`}
                      {batch.failed > 0 && ` · ${batch.failed} failed`}
                      {batch.running > 0 && ` · ${batch.running} running`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        statusColors[batch.status] || "bg-muted text-muted-foreground"
                      }`}
                    >
                      {batch.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {batch.completed + batch.failed}/{batch.total}
                    </span>
                  </div>
                </div>
                {batch.total > 0 && (
                  <div className="mt-3 w-full bg-muted rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
