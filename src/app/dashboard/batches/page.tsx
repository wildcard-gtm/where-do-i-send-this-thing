"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface BatchJob {
  id: string;
  status: string;
}

interface Batch {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  jobs: BatchJob[];
}

const statusColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-primary/15 text-primary",
  complete: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
};

const statusTabs = ["all", "pending", "processing", "complete", "failed"];

export default function BatchesPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/batches")
      .then((res) => (res.ok ? res.json() : { batches: [] }))
      .then((data) => {
        setBatches(data.batches || []);
        setLoading(false);
      });
  }, []);

  const filtered = batches.filter((b) => {
    if (filter !== "all" && b.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = (b.name || "").toLowerCase();
      return name.includes(q);
    }
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
        <h1 className="text-2xl font-bold text-foreground">Scans</h1>
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

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search scans..."
            className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm"
          />
        </div>
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
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <p className="text-muted-foreground">
            {search ? "No scans match your search." : "No scans found."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((batch) => {
            const completed = batch.jobs.filter((j) => j.status === "complete").length;
            const total = batch.jobs.length;
            const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

            return (
              <div
                key={batch.id}
                className="bg-card rounded-xl border border-border p-5 cursor-pointer hover:border-primary/30 transition"
                onClick={() => router.push(`/dashboard/batches/${batch.id}`)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-foreground font-medium text-sm">
                      {batch.name || "Scan"} &middot; {total} URL{total !== 1 ? "s" : ""}
                    </h3>
                    <p className="text-muted-foreground text-xs mt-1">
                      {new Date(batch.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
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
                    </span>
                  </div>
                </div>
                {total > 0 && (
                  <div className="mt-3 w-full bg-border rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all"
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
