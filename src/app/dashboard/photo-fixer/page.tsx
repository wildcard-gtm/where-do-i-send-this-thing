"use client";

import { useState, useEffect } from "react";

interface Campaign {
  id: string;
  name: string;
  totalJobs: number;
  completedJobs: number;
  createdAt: string;
}

interface CompareResult {
  contactId: string;
  name: string;
  company: string;
  slug: string;
  dbPhotoUrl: string | null;
  vetricPhotoUrl: string | null;
  verdict: "MATCH" | "MISMATCH" | "MISSING" | "ERROR";
  reason: string;
}

export default function PhotoFixerPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CompareResult[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "mismatch" | "missing" | "match">("all");
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((d) => setCampaigns(d.campaigns || []))
      .catch(() => {});
  }, []);

  async function handleCompare() {
    if (!selectedBatch) return;
    setLoading(true);
    setResults(null);
    setSelected(new Set());
    setApplyResult(null);
    setProgress("Fetching contacts and downloading photos...");

    try {
      const res = await fetch("/api/photo-fixer/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: selectedBatch }),
      });
      const data = await res.json();
      if (data.results) {
        setResults(data.results);
        // Auto-select all mismatches
        const mismatches = new Set<string>(
          data.results
            .filter((r: CompareResult) => r.verdict === "MISMATCH")
            .map((r: CompareResult) => r.contactId)
        );
        setSelected(mismatches);
      }
    } catch {
      setProgress("Error running comparison");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  async function handleApply() {
    if (selected.size === 0) return;
    setApplying(true);
    setApplyResult(null);

    try {
      const res = await fetch("/api/photo-fixer/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: Array.from(selected) }),
      });
      const data = await res.json();
      setApplyResult(
        `Updated ${data.applied} contacts. ${data.failed} failed.`
      );
      // Refresh photos in results
      if (results && data.results) {
        setResults(
          results.map((r) => {
            const applied = data.results.find(
              (a: { contactId: string; success: boolean; newPhotoUrl?: string }) =>
                a.contactId === r.contactId && a.success
            );
            if (applied) {
              return { ...r, dbPhotoUrl: applied.newPhotoUrl, verdict: "MATCH" as const, reason: "Fixed" };
            }
            return r;
          })
        );
        setSelected(new Set());
      }
    } catch {
      setApplyResult("Error applying fixes");
    } finally {
      setApplying(false);
    }
  }

  function toggleSelect(contactId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  function selectAllMismatches() {
    if (!results) return;
    setSelected(
      new Set(results.filter((r) => r.verdict === "MISMATCH").map((r) => r.contactId))
    );
  }

  function selectNone() {
    setSelected(new Set());
  }

  const filtered = results
    ? filter === "all"
      ? results
      : results.filter((r) => r.verdict.toLowerCase() === filter)
    : [];

  const counts = results
    ? {
        match: results.filter((r) => r.verdict === "MATCH").length,
        mismatch: results.filter((r) => r.verdict === "MISMATCH").length,
        missing: results.filter((r) => r.verdict === "MISSING").length,
        error: results.filter((r) => r.verdict === "ERROR").length,
      }
    : null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Photo Fixer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compare contact photos against LinkedIn (Vetric) using AI vision and fix mismatches
        </p>
      </div>

      {/* Batch selector */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Select Campaign</h2>
        <div className="flex items-center gap-4">
          <select
            value={selectedBatch || ""}
            onChange={(e) => setSelectedBatch(e.target.value || null)}
            className="flex-1 bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">Choose a campaign...</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || `Campaign ${c.id.slice(-6)}`} ({c.completedJobs}/{c.totalJobs} contacts)
              </option>
            ))}
          </select>
          <button
            onClick={handleCompare}
            disabled={!selectedBatch || loading}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
          >
            {loading ? "Comparing..." : "Run Comparison"}
          </button>
        </div>
        {progress && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {progress}
          </div>
        )}
      </div>

      {/* Results */}
      {results && (
        <>
          {/* Summary + filters */}
          <div className="glass-card rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Results ({results.length} contacts)
              </h2>
              <div className="flex items-center gap-2">
                <button onClick={selectAllMismatches} className="text-xs text-primary hover:underline">
                  Select mismatches
                </button>
                <span className="text-muted-foreground">|</span>
                <button onClick={selectNone} className="text-xs text-muted-foreground hover:text-foreground">
                  Clear selection
                </button>
              </div>
            </div>

            {counts && (
              <div className="flex gap-2">
                <FilterPill label="All" count={results.length} active={filter === "all"} onClick={() => setFilter("all")} />
                <FilterPill label="Match" count={counts.match} active={filter === "match"} onClick={() => setFilter("match")} color="text-green-500" />
                <FilterPill label="Mismatch" count={counts.mismatch} active={filter === "mismatch"} onClick={() => setFilter("mismatch")} color="text-red-500" />
                <FilterPill label="Missing" count={counts.missing} active={filter === "missing"} onClick={() => setFilter("missing")} color="text-yellow-500" />
              </div>
            )}

            {selected.size > 0 && (
              <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-xl">
                <span className="text-sm text-foreground font-medium">
                  {selected.size} selected
                </span>
                <button
                  onClick={handleApply}
                  disabled={applying}
                  className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition disabled:opacity-50"
                >
                  {applying ? "Applying..." : "Replace with Vetric Photos"}
                </button>
                {applyResult && (
                  <span className="text-sm text-muted-foreground">{applyResult}</span>
                )}
              </div>
            )}
          </div>

          {/* Photo grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((r) => (
              <CompareCard
                key={r.contactId}
                result={r}
                checked={selected.has(r.contactId)}
                onToggle={() => toggleSelect(r.contactId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
  color,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-card border border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className={!active ? color : ""}>{label}</span>
      <span className="ml-1.5 opacity-70">{count}</span>
    </button>
  );
}

function CompareCard({
  result,
  checked,
  onToggle,
}: {
  result: CompareResult;
  checked: boolean;
  onToggle: () => void;
}) {
  const verdictColors = {
    MATCH: "border-green-500/30 bg-green-500/5",
    MISMATCH: "border-red-500/30 bg-red-500/5",
    MISSING: "border-yellow-500/30 bg-yellow-500/5",
    ERROR: "border-orange-500/30 bg-orange-500/5",
  };

  const verdictBadge = {
    MATCH: "bg-green-500/10 text-green-500",
    MISMATCH: "bg-red-500/10 text-red-500",
    MISSING: "bg-yellow-500/10 text-yellow-500",
    ERROR: "bg-orange-500/10 text-orange-500",
  };

  return (
    <div
      className={`rounded-2xl border p-4 space-y-3 transition ${verdictColors[result.verdict]} ${
        checked ? "ring-2 ring-primary" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{result.name}</p>
          <p className="text-xs text-muted-foreground truncate">{result.company}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${verdictBadge[result.verdict]}`}>
            {result.verdict}
          </span>
          {result.verdict === "MISMATCH" && (
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
            />
          )}
        </div>
      </div>

      {/* Side by side photos */}
      <div className="flex gap-3">
        <div className="flex-1 space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Database</p>
          <div className="aspect-square rounded-xl bg-card border border-border overflow-hidden">
            {result.dbPhotoUrl ? (
              <img
                src={result.dbPhotoUrl}
                alt="DB"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                No photo
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">LinkedIn (Vetric)</p>
          <div className="aspect-square rounded-xl bg-card border border-border overflow-hidden">
            {result.vetricPhotoUrl ? (
              <img
                src={result.vetricPhotoUrl}
                alt="Vetric"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                No photo
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reason */}
      <p className="text-xs text-muted-foreground">{result.reason}</p>
    </div>
  );
}
