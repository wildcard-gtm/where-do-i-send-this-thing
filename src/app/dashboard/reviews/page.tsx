"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TeamPhoto {
  name?: string;
  photoUrl: string;
  title?: string;
}

interface OpenRole {
  title: string;
  location?: string;
}

interface PostcardFull {
  id: string;
  contactId: string;
  template: string;
  status: string;
  imageUrl: string | null;
  contactName: string;
  contactTitle: string | null;
  contactPhoto: string | null;
  companyLogo: string | null;
  teamPhotos: TeamPhoto[] | null;
  openRoles: OpenRole[] | null;
  customPrompt: string | null;
  deliveryAddress: string | null;
  errorMessage: string | null;
  createdAt: string;
  contact: { id: string; name: string; company: string | null; profileImageUrl?: string | null };
}

interface Campaign {
  id: string;
  name: string | null;
  createdAt: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const statusColors: Record<string, string> = {
  ready: "text-accent bg-accent/10 border-accent/30",
  approved: "text-success bg-success/10 border-success/30",
  pending: "text-warning bg-warning/10 border-warning/30",
  generating: "text-primary bg-primary/10 border-primary/30",
  failed: "text-danger bg-danger/10 border-danger/30",
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ReviewsPage() {
  const [postcards, setPostcards] = useState<PostcardFull[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [templateFilter, setTemplateFilter] = useState<"all" | "warroom" | "zoom">("all");
  const [campaignId, setCampaignId] = useState("all");
  const [page, setPage] = useState(0);

  // Expanded card for editing
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { document.title = "Reviews | WDISTT"; }, []);

  // Load campaigns
  useEffect(() => {
    fetch("/api/campaigns")
      .then((res) => (res.ok ? res.json() : { campaigns: [] }))
      .then((data) => setCampaigns(data.campaigns || []));
  }, []);

  // Load postcards
  const loadPostcards = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ latestOnly: "true" });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (campaignId !== "all") params.set("campaignId", campaignId);
    fetch(`/api/postcards?${params}`)
      .then((res) => (res.ok ? res.json() : { postcards: [] }))
      .then((data) => {
        setPostcards(data.postcards || []);
        setLoading(false);
      });
  }, [statusFilter, campaignId]);

  useEffect(() => {
    loadPostcards();
  }, [loadPostcards]);

  // Filter + paginate
  const filtered = templateFilter === "all"
    ? postcards
    : postcards.filter((p) => p.template === templateFilter);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const counts = {
    total: postcards.length,
    ready: postcards.filter((p) => p.status === "ready").length,
    approved: postcards.filter((p) => p.status === "approved").length,
  };

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleApprove = async (id: string) => {
    await fetch(`/api/postcards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    setPostcards((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: "approved" } : p))
    );
  };

  const handleUnapprove = async (id: string) => {
    await fetch(`/api/postcards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ready" }),
    });
    setPostcards((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: "ready" } : p))
    );
  };

  const handleApproveAll = async () => {
    const readyCards = filtered.filter((p) => p.status === "ready");
    if (readyCards.length === 0) return;
    if (!confirm(`Approve all ${readyCards.length} ready postcards?`)) return;
    await Promise.all(
      readyCards.map((p) =>
        fetch(`/api/postcards/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        })
      )
    );
    setPostcards((prev) =>
      prev.map((p) =>
        readyCards.some((r) => r.id === p.id) ? { ...p, status: "approved" } : p
      )
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Review Postcards</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {counts.approved}/{counts.total} approved
            {counts.ready > 0 && ` · ${counts.ready} ready for review`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {counts.ready > 0 && (
            <button
              onClick={handleApproveAll}
              className="flex items-center gap-2 bg-success/15 hover:bg-success/25 text-success px-4 py-2 rounded-lg font-medium transition text-sm border border-success/30"
            >
              Approve All Ready ({counts.ready})
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
          <span>Review progress</span>
          <span>{counts.approved}/{counts.total}</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-success rounded-full transition-all duration-500"
            style={{ width: `${counts.total > 0 ? (counts.approved / counts.total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 overflow-x-auto">
        <div className="flex gap-1">
          {(["all", "ready", "approved"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setStatusFilter(tab); setPage(0); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap capitalize ${
                statusFilter === tab
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-card"
              }`}
            >
              {tab === "all" ? "All" : tab}
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-border shrink-0" />

        <div className="flex gap-1">
          {([
            { key: "all", label: "All Types" },
            { key: "warroom", label: "War Room" },
            { key: "zoom", label: "Zoom Room" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setTemplateFilter(key); setPage(0); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                templateFilter === key
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-card"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-border shrink-0" />

        <select
          value={campaignId}
          onChange={(e) => { setCampaignId(e.target.value); setPage(0); }}
          className="text-sm bg-transparent border border-border rounded-lg px-3 py-2 text-muted-foreground hover:border-muted-foreground cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="all">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || `Campaign ${new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
            </option>
          ))}
        </select>
      </div>

      {/* Cards */}
      {paged.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <h2 className="text-lg font-semibold text-foreground mb-2">No postcards to review</h2>
          <p className="text-muted-foreground text-sm">Generate postcards first from the Campaigns page.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {paged.map((postcard) => (
            <ReviewCard
              key={postcard.id}
              postcard={postcard}
              isEditing={editingId === postcard.id}
              onToggleEdit={() => setEditingId(editingId === postcard.id ? null : postcard.id)}
              onApprove={() => handleApprove(postcard.id)}
              onUnapprove={() => handleUnapprove(postcard.id)}
              onUpdated={(updated) => {
                setPostcards((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
              }}
              onRegenerated={(newId) => {
                // Replace the old postcard with a pending stub
                setPostcards((prev) =>
                  prev.map((p) =>
                    p.id === postcard.id
                      ? { ...p, id: newId, status: "pending", imageUrl: null }
                      : p
                  )
                );
                setEditingId(null);
              }}
              onReload={loadPostcards}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-8">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Review Card ──────────────────────────────────────────────────────────────

interface ReviewCardProps {
  postcard: PostcardFull;
  isEditing: boolean;
  onToggleEdit: () => void;
  onApprove: () => void;
  onUnapprove: () => void;
  onUpdated: (postcard: PostcardFull) => void;
  onRegenerated: (newPostcardId: string) => void;
  onReload: () => void;
}

function ReviewCard({
  postcard,
  isEditing,
  onToggleEdit,
  onApprove,
  onUnapprove,
  onUpdated,
  onRegenerated,
  onReload,
}: ReviewCardProps) {
  const [teamPhotos, setTeamPhotos] = useState<TeamPhoto[]>((postcard.teamPhotos as TeamPhoto[] | null) ?? []);
  const [openRoles, setOpenRoles] = useState<OpenRole[]>((postcard.openRoles as OpenRole[] | null) ?? []);
  const [contactPhoto, setContactPhoto] = useState(postcard.contactPhoto);
  const [companyLogo, setCompanyLogo] = useState(postcard.companyLogo);
  const [template, setTemplate] = useState(postcard.template);
  const [customPrompt, setCustomPrompt] = useState(postcard.customPrompt || "");
  const [regenerating, setRegenerating] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [pollingStatus, setPollingStatus] = useState<string | null>(null);
  const [pollingImageUrl, setPollingImageUrl] = useState<string | null>(null);

  const prospectFileRef = useRef<HTMLInputElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const teamFileRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Reset state when postcard changes
  useEffect(() => {
    setTeamPhotos((postcard.teamPhotos as TeamPhoto[] | null) ?? []);
    setOpenRoles((postcard.openRoles as OpenRole[] | null) ?? []);
    setContactPhoto(postcard.contactPhoto);
    setCompanyLogo(postcard.companyLogo);
    setTemplate(postcard.template);
    setCustomPrompt(postcard.customPrompt || "");
  }, [postcard]);

  // Poll for regeneration status
  useEffect(() => {
    if (!pollingId) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/postcards/${pollingId}`);
      if (!res.ok) return;
      const data = await res.json();
      const p = data.postcard;
      if (!p) return;
      setPollingStatus(p.status);
      if (p.status === "ready" || p.status === "approved") {
        setPollingImageUrl(p.imageUrl);
        clearInterval(interval);
        setPollingId(null);
        setRegenerating(false);
        // Reload full list so the new postcard data is complete
        onReload();
      } else if (p.status === "failed") {
        clearInterval(interval);
        setPollingId(null);
        setRegenerating(false);
        onReload();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [pollingId, onReload]);

  async function uploadImage(file: File): Promise<string | null> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/uploads/image", { method: "POST", body: formData });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url;
  }

  async function handleChangePhoto(field: string, setter: (url: string) => void, file: File) {
    setUploading(field);
    const url = await uploadImage(file);
    if (url) setter(url);
    setUploading(null);
  }

  async function handleChangeTeamPhoto(index: number, file: File) {
    setUploading(`team-${index}`);
    const url = await uploadImage(file);
    if (url) {
      setTeamPhotos((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], photoUrl: url };
        return updated;
      });
    }
    setUploading(null);
  }

  function toggleTeamMember(index: number) {
    setTeamPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const res = await fetch("/api/postcards/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: postcard.contactId,
          template,
          customPrompt: customPrompt.trim() || null,
          contactPhoto,
          teamPhotos: teamPhotos.length > 0 ? teamPhotos : undefined,
          companyLogo,
          openRoles: openRoles.length > 0 ? openRoles : undefined,
          parentPostcardId: postcard.id,
        }),
      });
      const data = await res.json();
      if (data.postcardId) {
        // Fire off generation
        fetch(`/api/postcards/${data.postcardId}/run`, { method: "POST" }).catch(() => {});
        setPollingId(data.postcardId);
        setPollingStatus("generating");
        setPollingImageUrl(null);
        onRegenerated(data.postcardId);
      } else {
        setRegenerating(false);
      }
    } catch {
      setRegenerating(false);
    }
  }

  const isGenerating = postcard.status === "pending" || postcard.status === "generating" || regenerating;
  const displayImageUrl = pollingImageUrl || postcard.imageUrl;

  return (
    <div className={`glass-card rounded-2xl overflow-hidden border ${
      postcard.status === "approved" ? "border-success/30" : "border-border"
    }`}>
      {/* Top section: Image + Info */}
      <div className="flex flex-col lg:flex-row">
        {/* Large postcard image */}
        <div className="lg:w-2/3 relative bg-muted">
          {isGenerating && !displayImageUrl ? (
            <div className="w-full aspect-[3/2] flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground capitalize">{pollingStatus || postcard.status}...</p>
            </div>
          ) : displayImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayImageUrl}
              alt={`Postcard for ${postcard.contactName}`}
              className="w-full aspect-[3/2] object-contain bg-black/5"
            />
          ) : (
            <div className="w-full aspect-[3/2] flex items-center justify-center text-muted-foreground">
              {postcard.status === "failed" ? (
                <div className="text-center">
                  <p className="text-sm font-medium text-danger">Generation failed</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">{postcard.errorMessage}</p>
                </div>
              ) : "No image"}
            </div>
          )}
          {/* Status badge overlay */}
          <div className="absolute top-3 left-3">
            <span className={`text-xs font-semibold px-3 py-1 rounded-full border backdrop-blur-sm capitalize ${
              statusColors[postcard.status] ?? "text-muted-foreground bg-muted border-border"
            }`}>
              {postcard.status}
            </span>
          </div>
        </div>

        {/* Right info panel */}
        <div className="lg:w-1/3 p-5 flex flex-col">
          {/* Contact info */}
          <div className="mb-4">
            <Link
              href={`/dashboard/contacts/${postcard.contactId}?tab=postcard`}
              className="text-base font-semibold text-foreground hover:text-primary transition"
            >
              {postcard.contactName}
            </Link>
            {postcard.contactTitle && (
              <p className="text-sm text-muted-foreground mt-0.5">{postcard.contactTitle}</p>
            )}
            {postcard.contact.company && (
              <p className="text-sm text-muted-foreground">{postcard.contact.company}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1 capitalize">{postcard.template} template</p>
          </div>

          {/* Quick info: photos available */}
          <div className="space-y-2 mb-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className={contactPhoto ? "text-success" : "text-danger"}>
                {contactPhoto ? "\u2713" : "\u2717"}
              </span>
              Prospect photo
            </div>
            <div className="flex items-center gap-2">
              <span className={companyLogo ? "text-success" : "text-danger"}>
                {companyLogo ? "\u2713" : "\u2717"}
              </span>
              Company logo
            </div>
            <div className="flex items-center gap-2">
              <span className={teamPhotos.length > 0 ? "text-success" : "text-warning"}>
                {teamPhotos.length > 0 ? "\u2713" : "\u26A0"}
              </span>
              {teamPhotos.length} team member{teamPhotos.length !== 1 ? "s" : ""}
            </div>
            <div className="flex items-center gap-2">
              <span className={(openRoles?.length ?? 0) > 0 ? "text-success" : "text-warning"}>
                {(openRoles?.length ?? 0) > 0 ? "\u2713" : "\u26A0"}
              </span>
              {openRoles?.length ?? 0} roles on whiteboard
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-auto space-y-2">
            {postcard.status === "ready" && (
              <button
                onClick={onApprove}
                className="w-full flex items-center justify-center gap-2 bg-success/15 hover:bg-success/25 text-success px-4 py-2.5 rounded-lg font-medium transition text-sm border border-success/30"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Approve
              </button>
            )}
            {postcard.status === "approved" && (
              <button
                onClick={onUnapprove}
                className="w-full flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 text-muted-foreground px-4 py-2.5 rounded-lg font-medium transition text-sm border border-border"
              >
                Unapprove
              </button>
            )}
            <button
              onClick={onToggleEdit}
              disabled={isGenerating}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition text-sm border ${
                isEditing
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "text-muted-foreground border-border hover:text-foreground hover:border-primary/50"
              } disabled:opacity-50`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {isEditing ? "Close Editor" : "Edit & Regenerate"}
            </button>
          </div>
        </div>
      </div>

      {/* Expandable editor panel */}
      {isEditing && (
        <div className="border-t border-border p-5 bg-card/50 space-y-5">
          {/* Row 1: Prospect + Logo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Prospect Photo */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">Prospect Photo</label>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center overflow-hidden shrink-0 border border-border">
                  {contactPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={contactPhoto} alt="Prospect" className="w-14 h-14 rounded-full object-cover" />
                  ) : (
                    <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  )}
                </div>
                <div className="space-y-1">
                  <input ref={prospectFileRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleChangePhoto("prospect", setContactPhoto, f); }} />
                  <button onClick={() => prospectFileRef.current?.click()} disabled={uploading === "prospect"}
                    className="text-xs text-primary hover:text-primary-hover font-medium transition disabled:opacity-50">
                    {uploading === "prospect" ? "Uploading..." : "Change"}
                  </button>
                  {contactPhoto && (
                    <button onClick={() => setContactPhoto(null)}
                      className="block text-xs text-muted-foreground hover:text-danger transition">Remove</button>
                  )}
                </div>
              </div>
            </div>

            {/* Company Logo */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">Company Logo</label>
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden shrink-0 border border-border">
                  {companyLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={companyLogo} alt="Logo" className="w-12 h-12 object-contain" />
                  ) : (
                    <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
                    </svg>
                  )}
                </div>
                <div className="space-y-1">
                  <input ref={logoFileRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleChangePhoto("logo", setCompanyLogo, f); }} />
                  <button onClick={() => logoFileRef.current?.click()} disabled={uploading === "logo"}
                    className="text-xs text-primary hover:text-primary-hover font-medium transition disabled:opacity-50">
                    {uploading === "logo" ? "Uploading..." : "Change"}
                  </button>
                  {companyLogo && (
                    <button onClick={() => setCompanyLogo(null)}
                      className="block text-xs text-muted-foreground hover:text-danger transition">Remove</button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Team Members */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Team Members ({teamPhotos.length})
            </label>
            {teamPhotos.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No team members. Postcard will use generic illustrated people.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {teamPhotos.map((tp, i) => (
                  <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl border border-border bg-muted/20">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                      {tp.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={tp.photoUrl} alt={tp.name || "Team"} className="w-9 h-9 rounded-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold text-primary">{(tp.name || "?")[0]?.toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <input type="text" value={tp.name || ""} placeholder="Name"
                        onChange={(e) => setTeamPhotos((prev) => {
                          const u = [...prev]; u[i] = { ...u[i], name: e.target.value }; return u;
                        })}
                        className="w-full text-xs font-medium text-foreground bg-transparent border-none p-0 focus:outline-none placeholder:text-muted-foreground/50" />
                      <input type="text" value={tp.title || ""} placeholder="Title"
                        onChange={(e) => setTeamPhotos((prev) => {
                          const u = [...prev]; u[i] = { ...u[i], title: e.target.value }; return u;
                        })}
                        className="w-full text-[11px] text-muted-foreground bg-transparent border-none p-0 focus:outline-none placeholder:text-muted-foreground/50" />
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <input ref={(el) => { teamFileRefs.current[i] = el; }} type="file" accept="image/*" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleChangeTeamPhoto(i, f); }} />
                      <button onClick={() => teamFileRefs.current[i]?.click()} disabled={uploading === `team-${i}`}
                        className="p-1 rounded text-muted-foreground hover:text-primary transition disabled:opacity-50" title="Change photo">
                        {uploading === `team-${i}` ? (
                          <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin inline-block" />
                        ) : (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                      <button onClick={() => toggleTeamMember(i)}
                        className="p-1 rounded text-muted-foreground hover:text-danger transition" title="Remove member">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Row 3: Whiteboard Roles */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Whiteboard Roles ({openRoles.length})
            </label>
            <div className="space-y-2">
              {openRoles.map((role, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="text" value={role.title} placeholder="Role title"
                    onChange={(e) => setOpenRoles((prev) => {
                      const u = [...prev]; u[i] = { ...u[i], title: e.target.value }; return u;
                    })}
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition" />
                  <input type="text" value={role.location || ""} placeholder="Location"
                    onChange={(e) => setOpenRoles((prev) => {
                      const u = [...prev]; u[i] = { ...u[i], location: e.target.value }; return u;
                    })}
                    className="w-32 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition placeholder:text-muted-foreground/50" />
                  <button onClick={() => setOpenRoles((prev) => prev.filter((_, j) => j !== i))}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-danger hover:bg-danger/10 transition" title="Remove role">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <button onClick={() => setOpenRoles((prev) => [...prev, { title: "", location: "" }])}
                className="text-xs text-primary hover:text-primary-hover font-medium transition">
                + Add Role
              </button>
            </div>
          </div>

          {/* Row 4: Template + Custom Prompt */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">Template</label>
              <div className="flex gap-2">
                <button onClick={() => setTemplate("warroom")}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition border ${
                    template === "warroom" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                  }`}>War Room</button>
                <button onClick={() => setTemplate("zoom")}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition border ${
                    template === "zoom" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                  }`}>Zoom Room</button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">Additional AI Instructions</label>
              <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder='e.g. "Make colors more vibrant" or "Person should wear blue shirt"'
                rows={2}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition resize-none placeholder:text-muted-foreground/50" />
            </div>
          </div>

          {/* Regenerate button */}
          <div className="flex justify-end">
            <button onClick={handleRegenerate} disabled={regenerating || uploading !== null}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-medium transition text-sm">
              {regenerating ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Regenerate Postcard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
