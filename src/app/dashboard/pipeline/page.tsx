"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface PipelineContact {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  linkedinUrl: string;
  recommendation: string | null;
  confidence: number | null;
  createdAt: string;
  // scan stage
  job: { status: string; batchId: string } | null;
  // enrichment stage (latest)
  companyEnrichments: { enrichmentStatus: string; currentStep: string | null }[];
  // postcard stage (latest)
  postcards: { status: string }[];
}

// ─── Pipeline stage helpers ────────────────────────────────────────────────

type StageState = "done" | "running" | "failed" | "none";

function getScanStage(contact: PipelineContact): StageState {
  const status = contact.job?.status;
  if (!status) return "none";
  if (status === "complete") return "done";
  if (status === "failed") return "failed";
  if (status === "running" || status === "pending") return "running";
  return "none";
}

function getEnrichStage(contact: PipelineContact): StageState {
  const e = contact.companyEnrichments[0];
  if (!e) return "none";
  if (e.enrichmentStatus === "completed") return "done";
  if (e.enrichmentStatus === "failed") return "failed";
  if (e.enrichmentStatus === "enriching") return "running";
  return "none";
}

function getPostcardStage(contact: PipelineContact): StageState {
  const p = contact.postcards[0];
  if (!p) return "none";
  if (p.status === "approved") return "done";
  if (p.status === "failed") return "failed";
  if (p.status === "ready") return "done";
  if (p.status === "pending" || p.status === "generating") return "running";
  return "none";
}

// ─── Stage chip ────────────────────────────────────────────────────────────

function StageChip({
  label,
  state,
  sublabel,
}: {
  label: string;
  state: StageState;
  sublabel?: string | null;
}) {
  const base = "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap";

  if (state === "done") {
    return (
      <span className={`${base} bg-success/10 text-success`}>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        {label}
      </span>
    );
  }

  if (state === "running") {
    return (
      <span className={`${base} bg-primary/10 text-primary`}>
        <div className="w-2.5 h-2.5 border-[1.5px] border-primary border-t-transparent rounded-full animate-spin shrink-0" />
        {sublabel || label}
      </span>
    );
  }

  if (state === "failed") {
    return (
      <span className={`${base} bg-danger/10 text-danger`}>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
        {label}
      </span>
    );
  }

  // none
  return (
    <span className={`${base} bg-muted text-muted-foreground/60`}>
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" strokeWidth={2} />
      </svg>
      {label}
    </span>
  );
}

// ─── Recommendation badge ──────────────────────────────────────────────────

const recColors: Record<string, string> = {
  HOME: "text-success",
  OFFICE: "text-primary",
  COURIER: "text-accent",
};

// ─── Filter tabs ───────────────────────────────────────────────────────────

const STAGE_FILTERS = [
  { key: "all", label: "All" },
  { key: "needs_enrich", label: "Needs Enrichment" },
  { key: "needs_postcard", label: "Needs Postcard" },
  { key: "ready", label: "Ready to Send" },
];

function matchesFilter(contact: PipelineContact, filter: string): boolean {
  if (filter === "all") return true;
  const scan = getScanStage(contact);
  const enrich = getEnrichStage(contact);
  const postcard = getPostcardStage(contact);
  if (filter === "needs_enrich") return scan === "done" && enrich === "none";
  if (filter === "needs_postcard") return enrich === "done" && postcard === "none";
  if (filter === "ready") return postcard === "done";
  return true;
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<PipelineContact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [generatingPostcards, setGeneratingPostcards] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchContacts = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    params.set("limit", "100");
    fetch(`/api/contacts?${params}`)
      .then((res) => (res.ok ? res.json() : { contacts: [], total: 0 }))
      .then((data) => {
        setContacts(data.contacts || []);
        setTotal(data.total || 0);
        setLoading(false);
      });
  }, [search]);

  useEffect(() => {
    setLoading(true);
    fetchContacts();
  }, [fetchContacts]);

  // Poll every 4s while anything is running
  useEffect(() => {
    const hasActive = contacts.some(
      (c) =>
        getScanStage(c) === "running" ||
        getEnrichStage(c) === "running" ||
        getPostcardStage(c) === "running"
    );
    if (!hasActive) return;
    const interval = setInterval(fetchContacts, 4000);
    return () => clearInterval(interval);
  }, [contacts, fetchContacts]);

  const filtered = contacts.filter((c) => matchesFilter(c, stageFilter));

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((c) => c.id)));
    }
  };

  const selectedIds = selected.size > 0 ? Array.from(selected) : filtered.map((c) => c.id);

  const handleEnrich = async () => {
    if (selectedIds.length === 0) return;
    setEnriching(true);
    setActionError(null);
    try {
      const res = await fetch("/api/contacts/enrich-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: selectedIds }),
      });
      const data = await res.json();
      if (res.ok && data.enrichmentBatchId) {
        router.push(`/dashboard/enrichments/${data.enrichmentBatchId}`);
      } else {
        setActionError(data.error || "Failed to start enrichment");
        setEnriching(false);
      }
    } catch {
      setActionError("Network error — please try again");
      setEnriching(false);
    }
  };

  const handleGeneratePostcards = async () => {
    if (selectedIds.length === 0) return;
    setGeneratingPostcards(true);
    setActionError(null);
    try {
      const res = await fetch("/api/postcards/generate-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: selectedIds }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push("/dashboard/postcards");
      } else {
        setActionError(data.error || "Failed to generate postcards");
        setGeneratingPostcards(false);
      }
    } catch {
      setActionError("Network error — please try again");
      setGeneratingPostcards(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const someSelected = selected.size > 0;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} contact{total !== 1 ? "s" : ""} · track progress from scan to postcard
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/dashboard/upload"
            className="inline-flex items-center gap-2 border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 px-4 py-2 rounded-lg font-medium transition text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Scan
          </Link>
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition text-sm"
          >
            {enriching ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            )}
            {someSelected ? `Enrich (${selected.size})` : "Enrich All"}
          </button>
          <button
            onClick={handleGeneratePostcards}
            disabled={generatingPostcards}
            className="inline-flex items-center gap-2 border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-50 px-4 py-2 rounded-lg font-medium transition text-sm"
          >
            {generatingPostcards ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            )}
            {someSelected ? `Postcards (${selected.size})` : "Generate Postcards"}
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 text-danger text-sm border border-danger/20">
          {actionError}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search contacts..."
          className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus-glow text-sm"
        />
      </div>

      {/* Stage filter tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto">
        {STAGE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => { setStageFilter(f.key); setSelected(new Set()); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              stageFilter === f.key
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-card"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Contact list */}
      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {search ? "No contacts match your search" : total === 0 ? "No contacts yet" : "No contacts in this stage"}
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            {total === 0
              ? "Upload LinkedIn URLs to start a scan and contacts will appear here."
              : "Try a different filter or search term."}
          </p>
          {total === 0 && (
            <Link
              href="/dashboard/upload"
              className="bg-primary hover:bg-primary-hover text-white px-6 py-2.5 rounded-lg font-medium transition inline-block text-sm"
            >
              New Scan
            </Link>
          )}
        </div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden">
          {/* Select-all row */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border/50 bg-muted/30">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">
              {someSelected ? `${selected.size} selected` : `${filtered.length} contact${filtered.length !== 1 ? "s" : ""}`}
            </span>
            {/* Column labels */}
            <div className="ml-auto hidden sm:flex items-center gap-6 pr-1 text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
              <span className="w-20 text-center">Scanned</span>
              <span className="w-20 text-center">Enriched</span>
              <span className="w-20 text-center">Postcard</span>
            </div>
          </div>

          <div className="divide-y divide-border/40">
            {filtered.map((contact) => {
              const scanStage = getScanStage(contact);
              const enrichStage = getEnrichStage(contact);
              const postcardStage = getPostcardStage(contact);
              const enrichStep = contact.companyEnrichments[0]?.currentStep ?? null;

              return (
                <div
                  key={contact.id}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-card-hover transition"
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selected.has(contact.id)}
                    onClick={(e) => toggleSelect(contact.id, e)}
                    onChange={() => {}}
                    className="w-4 h-4 rounded accent-primary cursor-pointer shrink-0"
                  />

                  {/* Contact info — clickable */}
                  <Link
                    href={`/dashboard/contacts/${contact.id}`}
                    className="flex items-center justify-between flex-1 min-w-0 gap-4"
                  >
                    {/* Avatar + name */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                        {contact.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {contact.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[contact.title, contact.company].filter(Boolean).join(" at ") ||
                            contact.linkedinUrl
                              .replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "")
                              .replace(/\/$/, "")}
                        </p>
                      </div>
                    </div>

                    {/* Recommendation */}
                    <div className="hidden md:block shrink-0 w-16 text-right">
                      {contact.recommendation && (
                        <span className={`text-xs font-semibold ${recColors[contact.recommendation] || "text-muted-foreground"}`}>
                          {contact.recommendation}
                        </span>
                      )}
                    </div>

                    {/* Pipeline stage chips */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="hidden sm:block w-20 flex justify-center">
                        <StageChip label="Scanned" state={scanStage} />
                      </div>
                      <div className="hidden sm:block w-20 flex justify-center">
                        <StageChip
                          label="Enriched"
                          state={enrichStage}
                          sublabel={enrichStep ?? undefined}
                        />
                      </div>
                      <div className="hidden sm:block w-20 flex justify-center">
                        <StageChip label="Postcard" state={postcardStage} />
                      </div>

                      {/* Mobile: condensed dots */}
                      <div className="flex sm:hidden items-center gap-1">
                        {[scanStage, enrichStage, postcardStage].map((s, i) => (
                          <div
                            key={i}
                            className={`w-2 h-2 rounded-full ${
                              s === "done" ? "bg-success" :
                              s === "running" ? "bg-primary animate-pulse" :
                              s === "failed" ? "bg-danger" :
                              "bg-muted-foreground/30"
                            }`}
                          />
                        ))}
                      </div>

                      <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
