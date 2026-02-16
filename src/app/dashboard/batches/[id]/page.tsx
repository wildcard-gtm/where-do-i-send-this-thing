"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface Job {
  id: string;
  linkedinUrl: string;
  personName: string | null;
  status: string;
  recommendation: string | null;
  confidence: number | null;
  createdAt: string;
}

interface Batch {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  jobs: Job[];
}

const statusColors: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-primary/15 text-primary",
  complete: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  processing: "bg-primary/15 text-primary",
};

const recommendationColors: Record<string, string> = {
  HOME: "text-success",
  OFFICE: "text-primary",
  BOTH: "text-accent",
};

export default function BatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.id as string;
  const [batch, setBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

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

  async function handleStart() {
    setStarting(true);
    const res = await fetch(`/api/batches/${batchId}/start`, {
      method: "POST",
    });
    if (res.ok) {
      fetchBatch();
    }
    setStarting(false);
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
        <button
          onClick={() => router.push("/dashboard")}
          className="text-primary hover:text-primary-hover mt-4"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const completed = batch.jobs.filter((j) => j.status === "complete").length;
  const total = batch.jobs.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">
              {batch.name || "Scan"}
            </h1>
            <span
              className={`text-xs font-medium px-3 py-1 rounded-full ${
                statusColors[batch.status] || statusColors.pending
              }`}
            >
              {batch.status}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Created{" "}
            {new Date(batch.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>

        <div className="flex gap-3">
          {batch.status === "pending" && (
            <button
              onClick={handleStart}
              disabled={starting}
              className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-medium transition text-sm"
            >
              {starting ? "Starting..." : "Start Processing"}
            </button>
          )}
          {(batch.status === "complete" || batch.status === "failed") && (
            <a
              href={`/api/batches/${batchId}/export`}
              className="bg-success hover:opacity-90 text-white px-6 py-2.5 rounded-lg font-medium transition text-sm"
            >
              Export CSV
            </a>
          )}
          <Link
            href="/dashboard"
            className="border border-border hover:border-muted-foreground text-muted-foreground hover:text-foreground px-6 py-2.5 rounded-lg font-medium transition text-sm"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-card rounded-xl border border-border p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-foreground font-medium">Progress</span>
          <span className="text-sm text-muted-foreground">
            {completed}/{total} complete ({progress}%)
          </span>
        </div>
        <div className="w-full bg-border rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Jobs Table - Desktop */}
      <div className="hidden lg:block bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">
                LinkedIn URL
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">
                Person
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">
                Status
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">
                Result
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-6 py-3">
                Confidence
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {batch.jobs.map((job) => (
              <tr
                key={job.id}
                className="hover:bg-card-hover cursor-pointer transition"
                onClick={() =>
                  router.push(
                    `/dashboard/batches/${batchId}/jobs/${job.id}`
                  )
                }
              >
                <td className="px-6 py-4">
                  <span className="text-sm text-foreground font-mono truncate block max-w-xs">
                    {job.linkedinUrl.replace(
                      /^https?:\/\/(www\.)?linkedin\.com\/in\//,
                      ""
                    ).replace(/\/$/, "")}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-sm text-foreground">
                    {job.personName || "\u2014"}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      statusColors[job.status] || statusColors.pending
                    }`}
                  >
                    {job.status === "running" && (
                      <span className="inline-block w-2 h-2 bg-primary rounded-full mr-1.5 animate-pulse" />
                    )}
                    {job.status}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {job.recommendation ? (
                    <span
                      className={`text-sm font-semibold ${
                        recommendationColors[job.recommendation] ||
                        "text-foreground"
                      }`}
                    >
                      {job.recommendation}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">{"\u2014"}</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  {job.confidence !== null ? (
                    <span
                      className={`text-sm font-medium ${
                        job.confidence >= 85
                          ? "text-success"
                          : job.confidence >= 75
                          ? "text-warning"
                          : "text-danger"
                      }`}
                    >
                      {job.confidence}%
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">{"\u2014"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Jobs Cards - Mobile */}
      <div className="lg:hidden space-y-3">
        {batch.jobs.map((job) => (
          <div
            key={job.id}
            className="bg-card rounded-xl border border-border p-4 cursor-pointer hover:border-primary/30 transition"
            onClick={() =>
              router.push(`/dashboard/batches/${batchId}/jobs/${job.id}`)
            }
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-mono text-foreground truncate mr-3">
                {job.linkedinUrl.replace(
                  /^https?:\/\/(www\.)?linkedin\.com\/in\//,
                  ""
                ).replace(/\/$/, "")}
              </span>
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${
                  statusColors[job.status] || statusColors.pending
                }`}
              >
                {job.status}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {job.personName || "Unknown"}
              </span>
              <div className="flex items-center gap-2">
                {job.recommendation && (
                  <span
                    className={`text-xs font-semibold ${
                      recommendationColors[job.recommendation] || "text-foreground"
                    }`}
                  >
                    {job.recommendation}
                  </span>
                )}
                {job.confidence !== null && (
                  <span className="text-xs text-muted-foreground">
                    {job.confidence}%
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
