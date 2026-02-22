"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ContactChat from "@/components/contacts/contact-chat";
import FeedbackButtons from "@/components/contacts/feedback-buttons";

const MapView = dynamic(() => import("@/components/results/map-view"), {
  ssr: false,
  loading: () => <div className="h-48 bg-card rounded-lg animate-pulse" />,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  linkedinUrl: string;
  company: string | null;
  title: string | null;
  recommendation: string | null;
  confidence: number | null;
  createdAt: string;
  job: { status: string; batchId: string } | null;
  companyEnrichments: { enrichmentStatus: string }[];
  postcards: { status: string }[];
}

interface ContactDetail {
  id: string;
  name: string;
  email: string | null;
  linkedinUrl: string;
  company: string | null;
  title: string | null;
  profileImageUrl: string | null;
  careerSummary: string | null;
  homeAddress: string | null;
  officeAddress: string | null;
  recommendation: string | null;
  confidence: number | null;
  lastScannedAt: string | null;
  notes: string | null;
  createdAt: string;
  job: { id: string; batchId: string; status: string; result: string | null } | null;
  chatMessages: { id: string; role: string; content: string; createdAt: string }[];
}

interface BatchOption {
  id: string;
  name: string | null;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const markdownProseClasses =
  "prose prose-sm max-w-none text-muted-foreground prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1.5 prose-p:leading-relaxed prose-ul:my-1.5 prose-ul:pl-4 prose-ol:my-1.5 prose-ol:pl-4 prose-li:my-0.5 prose-li:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold prose-a:text-primary prose-a:no-underline hover:prose-a:underline";

const recColors: Record<string, string> = {
  HOME: "text-success",
  OFFICE: "text-primary",
  BOTH: "text-accent",
};

const recBgColors: Record<string, string> = {
  HOME: "text-success bg-success/15",
  OFFICE: "text-primary bg-primary/15",
  COURIER: "text-accent bg-accent-light",
};

// ─── Stage chips (tiny per-contact badges) ────────────────────────────────────

function StageChips({
  scanStatus,
  enrichStatus,
  postcardStatus,
}: {
  scanStatus: string | null;
  enrichStatus: string | null;
  postcardStatus: string | null;
}) {
  const chips: { label: string; cls: string }[] = [];

  if (scanStatus === "complete") chips.push({ label: "Scanned", cls: "bg-success/10 text-success" });
  else if (scanStatus === "running") chips.push({ label: "Scanning", cls: "bg-primary/10 text-primary" });
  else if (scanStatus === "failed") chips.push({ label: "Scan failed", cls: "bg-danger/10 text-danger" });

  if (enrichStatus === "completed") chips.push({ label: "Enriched", cls: "bg-success/10 text-success" });
  else if (enrichStatus === "enriching") chips.push({ label: "Enriching", cls: "bg-primary/10 text-primary" });
  else if (enrichStatus === "failed") chips.push({ label: "Enrich failed", cls: "bg-danger/10 text-danger" });

  if (postcardStatus === "ready" || postcardStatus === "approved")
    chips.push({ label: "Postcard ready", cls: "bg-success/10 text-success" });
  else if (postcardStatus === "generating" || postcardStatus === "pending")
    chips.push({ label: "Generating", cls: "bg-primary/10 text-primary" });
  else if (postcardStatus === "failed")
    chips.push({ label: "Postcard failed", cls: "bg-danger/10 text-danger" });

  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {chips.map((c) => (
        <span key={c.label} className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${c.cls}`}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

// ─── Contact detail modal ─────────────────────────────────────────────────────

function ContactModal({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const router = useRouter();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "chat" | "postcard">("overview");
  const [isAdmin, setIsAdmin] = useState(false);
  const [postcard, setPostcard] = useState<{
    id: string; status: string; imageUrl: string | null; template: string;
  } | null>(null);
  const [postcardLoading, setPostcardLoading] = useState(false);
  const [postcardGenerating, setPostcardGenerating] = useState(false);

  // Load contact detail
  useEffect(() => {
    setLoading(true);
    fetch(`/api/contacts/${contactId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.contact) setContact(data.contact);
        if (data?.userRole === "admin") setIsAdmin(true);
        setLoading(false);
      });
  }, [contactId]);

  // Load postcard when tab opens
  useEffect(() => {
    if (tab !== "postcard") return;
    setPostcardLoading(true);
    fetch(`/api/contacts/${contactId}/postcards`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setPostcard(data?.postcards?.[0] ?? null);
        setPostcardLoading(false);
      });
  }, [tab, contactId]);

  // Poll while generating
  useEffect(() => {
    if (!postcard) return;
    if (postcard.status !== "pending" && postcard.status !== "generating") return;
    const interval = setInterval(() => {
      fetch(`/api/postcards/${postcard.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (data?.postcard) setPostcard(data.postcard); });
    }, 4000);
    return () => clearInterval(interval);
  }, [postcard?.id, postcard?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleGeneratePostcard = async () => {
    setPostcardGenerating(true);
    const res = await fetch("/api/postcards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId }),
    });
    const data = await res.json();
    if (data.postcardId) {
      setPostcard({ id: data.postcardId, status: "pending", imageUrl: null, template: data.template });
      fetch(`/api/postcards/${data.postcardId}/run`, { method: "POST" }).catch(() => {});
    }
    setPostcardGenerating(false);
  };

  const handleApprovePostcard = async (id: string) => {
    await fetch(`/api/postcards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    setPostcard((p) => p ? { ...p, status: "approved" } : p);
  };

  const jobResult = contact?.job?.result ? (() => { try { return JSON.parse(contact.job!.result!); } catch { return null; } })() : null;
  const decision = jobResult?.decision;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full sm:max-w-3xl max-h-[92dvh] sm:max-h-[85vh] bg-background border border-border rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
          {loading ? (
            <div className="h-5 w-40 bg-muted rounded animate-pulse" />
          ) : contact ? (
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                {contact.profileImageUrl
                  ? <img src={contact.profileImageUrl} alt={contact.name} className="w-10 h-10 rounded-full object-cover" />
                  : contact.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{contact.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[contact.title, contact.company].filter(Boolean).join(" at ") || "—"}
                </p>
              </div>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Contact</span>
          )}

          <div className="flex items-center gap-2 shrink-0 ml-4">
            {contact && (
              <button
                onClick={() => router.push(`/dashboard/contacts/${contactId}`)}
                className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border hover:border-primary/50 transition"
              >
                Full page
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        {!loading && contact && (
          <div className="flex gap-1 px-5 py-2 border-b border-border/50 shrink-0">
            {(["overview", "chat", "postcard"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition capitalize ${
                  tab === t ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-card"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center h-48">
              <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && !contact && (
            <p className="text-center text-muted-foreground py-12">Contact not found.</p>
          )}

          {/* ── Overview tab ── */}
          {!loading && contact && tab === "overview" && (
            <div className="space-y-4">
              {contact.recommendation && (
                <div className="glass-card rounded-xl p-4 flex items-center justify-between gap-3">
                  <span className={`text-base font-bold px-3 py-1.5 rounded-lg ${recBgColors[contact.recommendation] ?? "bg-muted text-foreground"}`}>
                    Send to {contact.recommendation}
                  </span>
                  {contact.confidence !== null && (
                    <span className={`text-sm font-semibold ${contact.confidence >= 85 ? "text-success" : contact.confidence >= 75 ? "text-warning" : "text-danger"}`}>
                      {contact.confidence}%
                    </span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {contact.homeAddress && (
                  <div className="glass-card rounded-xl p-4">
                    <p className="text-xs font-medium text-foreground mb-1 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                      Home
                    </p>
                    <p className="text-xs text-muted-foreground">{contact.homeAddress}</p>
                  </div>
                )}
                {contact.officeAddress && (
                  <div className="glass-card rounded-xl p-4">
                    <p className="text-xs font-medium text-foreground mb-1 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      Office
                    </p>
                    <p className="text-xs text-muted-foreground">{contact.officeAddress}</p>
                  </div>
                )}
              </div>

              {(contact.homeAddress || contact.officeAddress) && (
                <div className="glass-card rounded-xl p-3">
                  <MapView homeAddress={contact.homeAddress || undefined} officeAddress={contact.officeAddress || undefined} />
                </div>
              )}

              {contact.careerSummary && (
                <div className="glass-card rounded-xl p-4">
                  <h4 className="text-xs font-semibold text-foreground mb-2">Background</h4>
                  <div className={markdownProseClasses}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{contact.careerSummary}</ReactMarkdown>
                  </div>
                </div>
              )}

              {decision?.reasoning && (
                <div className="glass-card rounded-xl p-4">
                  <h4 className="text-xs font-semibold text-foreground mb-2">Report</h4>
                  <div className={markdownProseClasses}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{decision.reasoning}</ReactMarkdown>
                  </div>
                </div>
              )}

              <div className="glass-card rounded-xl p-4">
                <h4 className="text-xs font-semibold text-foreground mb-3">Details</h4>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                  {contact.email && (
                    <><dt className="text-muted-foreground">Email</dt><dd className="text-foreground truncate">{contact.email}</dd></>
                  )}
                  <dt className="text-muted-foreground">LinkedIn</dt>
                  <dd>
                    <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate block">
                      {contact.linkedinUrl.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "")}
                    </a>
                  </dd>
                  {contact.lastScannedAt && (
                    <><dt className="text-muted-foreground">Scanned</dt>
                    <dd className="text-foreground">{new Date(contact.lastScannedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd></>
                  )}
                  {contact.job && (
                    <><dt className="text-muted-foreground">Campaign</dt>
                    <dd>
                      <button onClick={() => { onClose(); router.push(`/dashboard/batches/${contact.job!.batchId}`); }} className="text-primary hover:underline">
                        View scan →
                      </button>
                    </dd></>
                  )}
                </dl>
              </div>

              <div className="glass-card rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-3">Was this report helpful?</p>
                <FeedbackButtons contactId={contactId} />
              </div>

              {isAdmin && contact.notes && (
                <div className="glass-card rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-xs font-semibold text-foreground">Logs</h4>
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">admin</span>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">{contact.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Chat tab ── */}
          {!loading && contact && tab === "chat" && (
            <ContactChat
              contactId={contact.id}
              contactName={contact.name}
              initialMessages={contact.chatMessages}
            />
          )}

          {/* ── Postcard tab ── */}
          {!loading && contact && tab === "postcard" && (
            <div>
              {postcardLoading && (
                <div className="flex items-center justify-center h-40">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!postcardLoading && !postcard && (
                <div className="text-center py-10">
                  <p className="text-sm text-muted-foreground mb-4">No postcard generated yet.</p>
                  <button
                    onClick={handleGeneratePostcard}
                    disabled={postcardGenerating}
                    className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium transition text-sm"
                  >
                    {postcardGenerating
                      ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    }
                    Generate Postcard
                  </button>
                </div>
              )}
              {!postcardLoading && postcard && (postcard.status === "pending" || postcard.status === "generating") && (
                <div className="flex flex-col items-center py-10 gap-3">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-muted-foreground">{postcard.status === "pending" ? "Queued..." : "Generating postcard..."}</p>
                  <p className="text-xs text-muted-foreground/60">~30–60 seconds</p>
                </div>
              )}
              {!postcardLoading && postcard && postcard.status === "failed" && (
                <div className="text-center py-8">
                  <p className="text-danger text-sm font-medium mb-3">Generation failed</p>
                  <button onClick={handleGeneratePostcard} disabled={postcardGenerating} className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition text-sm">
                    Try Again
                  </button>
                </div>
              )}
              {!postcardLoading && postcard && (postcard.status === "ready" || postcard.status === "approved") && (
                <div>
                  {postcard.imageUrl && <img src={postcard.imageUrl} alt="Postcard" className="w-full rounded-xl mb-4" />}
                  <div className="flex flex-wrap items-center gap-2">
                    {postcard.status === "ready" && (
                      <button onClick={() => handleApprovePostcard(postcard.id)} className="bg-success/10 text-success hover:bg-success/20 px-4 py-2 rounded-lg font-medium transition text-sm">
                        Approve
                      </button>
                    )}
                    {postcard.status === "approved" && <span className="text-success text-sm font-medium">✓ Approved</span>}
                    {postcard.imageUrl && (
                      <a href={postcard.imageUrl} download className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground transition text-sm font-medium">
                        Download
                      </a>
                    )}
                    <button onClick={() => window.open(`/dashboard/postcards/${postcard.id}`, "_blank")} className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground transition text-sm font-medium">
                      Full Review →
                    </button>
                    <button onClick={handleGeneratePostcard} disabled={postcardGenerating} className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 transition text-sm font-medium">
                      Regenerate
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main contacts page ───────────────────────────────────────────────────────

const filterTabs = ["all", "HOME", "OFFICE", "BOTH"] as const;

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [batchFilter, setBatchFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [modalContactId, setModalContactId] = useState<string | null>(null);

  const fetchContacts = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (filter !== "all") params.set("recommendation", filter);
    if (batchFilter !== "all") params.set("batchId", batchFilter);
    params.set("limit", "50");
    fetch(`/api/contacts?${params}`)
      .then((r) => (r.ok ? r.json() : { contacts: [], total: 0, batches: [] }))
      .then((data) => {
        setContacts(data.contacts ?? []);
        setTotal(data.total ?? 0);
        if (data.batches) setBatches(data.batches);
        setLoading(false);
      });
  }, [search, filter, batchFilter]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSelectAll = () => {
    setSelected(selected.size === contacts.length ? new Set() : new Set(contacts.map((c) => c.id)));
  };

  const handleEnrich = async () => {
    const ids = selected.size > 0 ? Array.from(selected) : contacts.map((c) => c.id);
    if (ids.length === 0) return;
    setEnriching(true);
    setEnrichError(null);
    try {
      const res = await fetch("/api/contacts/enrich-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: ids }),
      });
      const data = await res.json();
      if (res.ok && data.enrichmentBatchId) {
        router.push(`/dashboard/enrichments/${data.enrichmentBatchId}`);
      } else {
        setEnrichError(data.error ?? "Failed to start enrichment");
        setEnriching(false);
      }
    } catch {
      setEnrichError("Network error — please try again");
      setEnriching(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const allSelected = contacts.length > 0 && selected.size === contacts.length;
  const someSelected = selected.size > 0;

  return (
    <div>
      {/* Contact modal */}
      {modalContactId && (
        <ContactModal contactId={modalContactId} onClose={() => setModalContactId(null)} />
      )}

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} contact{total !== 1 ? "s" : ""} in your database
          </p>
        </div>
        {contacts.length > 0 && (
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition text-sm shrink-0"
          >
            {enriching
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            }
            {someSelected ? `Enrich Selected (${selected.size})` : "Enrich All"}
          </button>
        )}
      </div>

      {enrichError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger/10 text-danger text-sm border border-danger/20">
          {enrichError}
        </div>
      )}

      {/* Search + Campaign filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, company, or email..."
            className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus-glow text-sm"
          />
        </div>
        {batches.length > 0 && (
          <select
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            className="bg-card border border-border rounded-lg text-foreground text-sm px-3 py-2.5 focus-glow min-w-[160px]"
          >
            <option value="all">All campaigns</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Recommendation filter tabs */}
      <div className="flex gap-1 mb-5 overflow-x-auto">
        {filterTabs.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              filter === t ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-card"
            }`}
          >
            {t === "all" ? "All" : t}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {contacts.length === 0 && (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {search ? "No contacts match your search" : "No contacts yet"}
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            {search ? "Try adjusting your search terms." : "Contacts are created automatically when scans complete."}
          </p>
          {!search && (
            <Link
              href="/dashboard/batches"
              className="bg-primary hover:bg-primary-hover text-white px-6 py-2.5 rounded-lg font-medium transition inline-block text-sm"
            >
              Go to Campaigns
            </Link>
          )}
        </div>
      )}

      {/* Contact list */}
      {contacts.length > 0 && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-border/50 bg-muted/30">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded accent-primary cursor-pointer" />
            <span className="text-xs text-muted-foreground">
              {someSelected ? `${selected.size} selected` : "Select all"}
            </span>
          </div>

          <div className="divide-y divide-border/50">
            {contacts.map((contact) => {
              const scanStatus = contact.job?.status ?? null;
              const enrichStatus = contact.companyEnrichments[0]?.enrichmentStatus ?? null;
              const postcardStatus = contact.postcards[0]?.status ?? null;

              return (
                <div
                  key={contact.id}
                  className="flex items-center gap-3 px-5 py-4 hover:bg-card-hover transition cursor-pointer"
                  onClick={() => setModalContactId(contact.id)}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(contact.id)}
                    onClick={(e) => toggleSelect(contact.id, e)}
                    onChange={() => {}}
                    className="w-4 h-4 rounded accent-primary cursor-pointer shrink-0"
                  />
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                    {contact.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{contact.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[contact.title, contact.company].filter(Boolean).join(" at ") ||
                        contact.linkedinUrl.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "")}
                    </p>
                    <StageChips scanStatus={scanStatus} enrichStatus={enrichStatus} postcardStatus={postcardStatus} />
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {contact.recommendation && (
                      <span className={`text-xs font-semibold ${recColors[contact.recommendation] ?? "text-muted-foreground"}`}>
                        {contact.recommendation}
                      </span>
                    )}
                    {contact.confidence !== null && (
                      <span className={`text-xs font-medium ${contact.confidence >= 85 ? "text-success" : contact.confidence >= 75 ? "text-warning" : "text-danger"}`}>
                        {contact.confidence}%
                      </span>
                    )}
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
