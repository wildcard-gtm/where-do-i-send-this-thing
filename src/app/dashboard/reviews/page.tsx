"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TeamPhoto {
  name?: string;
  photoUrl: string;
  title?: string;
  linkedinUrl?: string;
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
  backMessage: string | null;
  deliveryAddress: string | null;
  errorMessage: string | null;
  parentPostcardId: string | null;
  createdAt: string;
  contact: { id: string; name: string; company: string | null; linkedinUrl: string; profileImageUrl?: string | null; companyEnrichments?: { companyName: string }[] };
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
  reviewed: "text-primary bg-primary/10 border-primary/30",
  pending: "text-warning bg-warning/10 border-warning/30",
  generating: "text-primary bg-primary/10 border-primary/30",
  failed: "text-danger bg-danger/10 border-danger/30",
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ReviewsPage() {
  const [postcards, setPostcards] = useState<PostcardFull[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"to-review" | "reviewed">("to-review");
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
  const loadPostcards = () => {
    setLoading(true);
    const params = new URLSearchParams({ latestOnly: "true", includeAll: "true" });
    if (campaignId !== "all") params.set("campaignId", campaignId);
    fetch(`/api/postcards?${params}`)
      .then((res) => (res.ok ? res.json() : { postcards: [] }))
      .then((data) => {
        // Filter out cancelled/failed but keep generating/pending for progress display
        const visible = (data.postcards || []).filter(
          (p: PostcardFull) => ["ready", "approved", "reviewed", "generating", "pending"].includes(p.status)
        );
        setPostcards(visible);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadPostcards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // Split by tab: "to-review" shows ready+approved+generating/pending, "reviewed" shows reviewed
  const toReviewCards = postcards.filter((p) => ["ready", "approved", "generating", "pending"].includes(p.status));
  const reviewedCards = postcards.filter((p) => p.status === "reviewed");
  const tabCards = tab === "to-review" ? toReviewCards : reviewedCards;

  // Filter by template + paginate
  const filtered = templateFilter === "all"
    ? tabCards
    : tabCards.filter((p) => p.template === templateFilter);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const counts = {
    total: postcards.length,
    ready: postcards.filter((p) => p.status === "ready").length,
    approved: postcards.filter((p) => p.status === "approved").length,
    reviewed: reviewedCards.length,
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

  const handleMarkReviewed = async (id: string) => {
    await fetch(`/api/postcards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "reviewed" }),
    });
    setPostcards((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: "reviewed" } : p))
    );
  };

  const handleUnreview = async (id: string) => {
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
            {counts.approved} approved · {counts.reviewed} reviewed · {counts.ready} to review
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "to-review" && counts.ready > 0 && (
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
          <span>{counts.reviewed + counts.approved}/{toReviewCards.length + reviewedCards.length}</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-success rounded-full transition-all duration-500"
            style={{ width: `${counts.total > 0 ? ((counts.reviewed + counts.approved) / counts.total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        <button
          onClick={() => { setTab("to-review"); setPage(0); }}
          className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            tab === "to-review"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          To Review {toReviewCards.length > 0 && <span className="ml-1.5 text-xs bg-muted px-2 py-0.5 rounded-full">{toReviewCards.length}</span>}
        </button>
        <button
          onClick={() => { setTab("reviewed"); setPage(0); }}
          className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            tab === "reviewed"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Reviewed {reviewedCards.length > 0 && <span className="ml-1.5 text-xs bg-muted px-2 py-0.5 rounded-full">{reviewedCards.length}</span>}
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 overflow-x-auto">
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
              key={`${postcard.id}-${postcard.status}`}
              postcard={postcard}
              isEditing={editingId === postcard.id}
              onToggleEdit={() => setEditingId(editingId === postcard.id ? null : postcard.id)}
              onApprove={() => handleApprove(postcard.id)}
              onUnapprove={() => handleUnapprove(postcard.id)}
              onMarkReviewed={() => handleMarkReviewed(postcard.id)}
              onUnreview={() => handleUnreview(postcard.id)}
              onUpdated={(updated) => {
                setPostcards((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
              }}
              onRegenerated={() => {
                // Don't update postcard ID in parent state — that would change the key,
                // remount the component, and lose the polling state.
                // The ReviewCard handles polling internally and calls onReload when done.
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
  onMarkReviewed: () => void;
  onUnreview: () => void;
  onUpdated: (postcard: PostcardFull) => void;
  onRegenerated: () => void;
  onReload: () => void;
}

function ReviewCard({
  postcard,
  isEditing,
  onToggleEdit,
  onApprove,
  onUnapprove,
  onMarkReviewed,
  onUnreview,
  onUpdated,
  onRegenerated,
  onReload,
}: ReviewCardProps) {
  // Use postcard.id as reset key — when the postcard changes (reload/regenerate),
  // React remounts the component via the key={postcard.id} on the parent, resetting all state.
  const [teamPhotos, setTeamPhotos] = useState<TeamPhoto[]>((postcard.teamPhotos as TeamPhoto[] | null) ?? []);
  const [openRoles, setOpenRoles] = useState<OpenRole[]>((postcard.openRoles as OpenRole[] | null) ?? []);
  const isPlaceholder = !postcard.contactPhoto || postcard.contactPhoto.includes('static.licdn.com') || postcard.contactPhoto.includes('ghost') || postcard.contactPhoto.includes('default-avatar');
  const [contactPhoto, setContactPhoto] = useState(isPlaceholder && postcard.contact?.profileImageUrl ? postcard.contact.profileImageUrl : postcard.contactPhoto);
  const [companyLogo, setCompanyLogo] = useState(postcard.companyLogo);
  const [companyName, setCompanyName] = useState(postcard.contact.companyEnrichments?.[0]?.companyName || postcard.contact.company || "");
  const [template, setTemplate] = useState(postcard.template);
  const [customPrompt, setCustomPrompt] = useState(postcard.customPrompt || "");
  const [backMessage, setBackMessage] = useState(postcard.backMessage || "");
  const [savingBackMessage, setSavingBackMessage] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [pollingStatus, setPollingStatus] = useState<string | null>(null);
  const [pollingImageUrl, setPollingImageUrl] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [olderVersions, setOlderVersions] = useState<PostcardFull[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const prospectFileRef = useRef<HTMLInputElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const teamFileRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resume polling on mount if the postcard has a child that's generating
  useEffect(() => {
    if (postcard.status === "generating" || postcard.status === "pending") {
      // This postcard itself is generating (e.g. page reload during generation)
      setPollingId(postcard.id);
      setRegenerating(true);
      setPollingStatus(postcard.status);
      setProgressText(postcard.errorMessage || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Show progress from errorMessage (e.g. "Attempt 2/7: analyzing")
      if (p.errorMessage && p.status === "generating") {
        setProgressText(p.errorMessage);
      }
      if (p.status === "ready" || p.status === "approved" || p.status === "reviewed") {
        setPollingImageUrl(p.imageUrl);
        setProgressText(null);
        clearInterval(interval);
        setPollingId(null);
        setRegenerating(false);
        onReload();
      } else if (p.status === "failed") {
        setProgressText(p.errorMessage || "Generation failed");
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

  async function handleSaveBackMessage() {
    setSavingBackMessage(true);
    await fetch(`/api/postcards/${postcard.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backMessage: backMessage.trim() }),
    });
    setSavingBackMessage(false);
    onUpdated({ ...postcard, backMessage: backMessage.trim() });
  }

  async function handleDownload() {
    if (!displayImageUrl) return;
    const res = await fetch(displayImageUrl);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${postcard.contactName.replace(/[^a-z0-9]/gi, "_")}-postcard.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadVersions() {
    setShowVersions(true);
    setVersionsLoading(true);
    const res = await fetch(`/api/postcards?contactId=${postcard.contactId}&includeAll=true`);
    const data = res.ok ? await res.json() : { postcards: [] };
    // Show all versions except the current one, only ready/approved
    setOlderVersions(
      (data.postcards || []).filter(
        (p: PostcardFull) => p.id !== postcard.id && (p.status === "ready" || p.status === "approved")
      )
    );
    setVersionsLoading(false);
  }

  async function handleRestore(oldId: string) {
    // Approve the old version, demote current to ready
    await fetch(`/api/postcards/${oldId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    if (postcard.id !== oldId) {
      await fetch(`/api/postcards/${postcard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ready" }),
      });
    }
    setShowVersions(false);
    onReload();
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
          companyName: companyName.trim() || undefined,
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
        onRegenerated();
      } else {
        setRegenerating(false);
      }
    } catch {
      setRegenerating(false);
    }
  }

  const isGenerating = postcard.status === "pending" || postcard.status === "generating" || regenerating;
  // When actively regenerating (pollingId set), hide old image until new one arrives
  const displayImageUrl = pollingId ? pollingImageUrl : (pollingImageUrl || postcard.imageUrl);

  return (
    <div className={`glass-card rounded-2xl overflow-hidden border ${
      postcard.status === "approved" ? "border-success/30" : "border-border"
    }`}>
      {/* Top section: Image + Info */}
      <div className="flex flex-col lg:flex-row">
        {/* Large postcard image */}
        <div className="lg:w-2/3 relative bg-muted">
          {isGenerating && !displayImageUrl ? (
            <div className="w-full aspect-[3/2] flex flex-col items-center justify-center gap-4 px-6">
              <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground capitalize">{pollingStatus || postcard.status}...</p>
                {progressText && (
                  <p className="text-xs text-muted-foreground max-w-md">{progressText}</p>
                )}
              </div>
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
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/contacts/${postcard.contactId}?tab=postcard`}
                className="text-base font-semibold text-foreground hover:text-primary transition"
              >
                {postcard.contactName}
              </Link>
              <a
                href={postcard.contact.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-muted-foreground/50 hover:text-[#0A66C2] transition"
                title="LinkedIn profile"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              </a>
            </div>
            {postcard.contactTitle && (
              <p className="text-sm text-muted-foreground mt-0.5">{postcard.contactTitle}</p>
            )}
            {(postcard.contact.companyEnrichments?.[0]?.companyName || postcard.contact.company) && (
              <p className="text-sm text-muted-foreground">{postcard.contact.companyEnrichments?.[0]?.companyName || postcard.contact.company}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1 capitalize">{postcard.template} template</p>
            {postcard.deliveryAddress && (
              <p className="text-xs text-muted-foreground mt-1 truncate" title={postcard.deliveryAddress}>
                {"\uD83D\uDCCD"} {postcard.deliveryAddress}
              </p>
            )}
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
              <div className="flex gap-2">
                <button
                  onClick={onApprove}
                  className="flex-1 flex items-center justify-center gap-2 bg-success/15 hover:bg-success/25 text-success px-4 py-2.5 rounded-lg font-medium transition text-sm border border-success/30"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Approve
                </button>
                <button
                  onClick={onMarkReviewed}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2.5 rounded-lg font-medium transition text-sm border border-primary/30"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Reviewed
                </button>
              </div>
            )}
            {postcard.status === "approved" && (
              <button
                onClick={onUnapprove}
                className="w-full flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 text-muted-foreground px-4 py-2.5 rounded-lg font-medium transition text-sm border border-border"
              >
                Unapprove
              </button>
            )}
            {postcard.status === "reviewed" && (
              <div className="flex gap-2">
                <button
                  onClick={onApprove}
                  className="flex-1 flex items-center justify-center gap-2 bg-success/15 hover:bg-success/25 text-success px-4 py-2.5 rounded-lg font-medium transition text-sm border border-success/30"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Approve
                </button>
                <button
                  onClick={onUnreview}
                  className="flex-1 flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 text-muted-foreground px-4 py-2.5 rounded-lg font-medium transition text-sm border border-border"
                >
                  Move Back
                </button>
              </div>
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
            <div className="flex gap-2">
              {displayImageUrl && (
                <button
                  onClick={handleDownload}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground border border-border hover:text-foreground transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </button>
              )}
              <button
                onClick={loadVersions}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground border border-border hover:text-foreground transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Versions
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Versions modal */}
      {showVersions && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowVersions(false)}>
          <div className="bg-card rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-foreground">Versions — {postcard.contactName}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Select an older version to restore it as current.</p>
              </div>
              <button onClick={() => setShowVersions(false)} className="text-muted-foreground hover:text-foreground transition text-xl">&times;</button>
            </div>
            <div className="p-5">
              {versionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : olderVersions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No older versions available.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {olderVersions.map((v) => (
                    <div key={v.id} className="border border-border rounded-xl overflow-hidden hover:border-primary/50 transition">
                      {v.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={v.imageUrl} alt="Postcard version" className="w-full aspect-[3/2] object-cover" />
                      ) : (
                        <div className="w-full aspect-[3/2] bg-muted flex items-center justify-center text-muted-foreground text-xs">No image</div>
                      )}
                      <div className="p-3 flex items-center justify-between">
                        <div>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
                            statusColors[v.status] ?? "text-muted-foreground bg-muted"
                          }`}>{v.status}</span>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(v.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRestore(v.id)}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition"
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

            {/* Company Logo + Name */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">Company Logo</label>
              <div className="mb-2">
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Company name"
                  className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition placeholder:text-muted-foreground/50"
                />
              </div>
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
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-muted-foreground">
                Team Members ({teamPhotos.length})
              </label>
              <div className="flex gap-2">
                {teamPhotos.length < ((postcard.teamPhotos as TeamPhoto[] | null) ?? []).length && (
                  <button
                    onClick={() => setTeamPhotos((postcard.teamPhotos as TeamPhoto[] | null) ?? [])}
                    className="text-[11px] text-muted-foreground hover:text-primary transition"
                  >
                    Reset
                  </button>
                )}
                <button
                  onClick={() => setTeamPhotos((prev) => [...prev, { photoUrl: "", name: "", title: "" }])}
                  className="text-[11px] text-primary hover:text-primary/80 transition font-medium"
                >
                  + Add Member
                </button>
              </div>
            </div>
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
                    <div className="flex-1 min-w-0 space-y-0.5">
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
                      <div className="flex items-center gap-1">
                        <svg className="w-2.5 h-2.5 shrink-0 text-muted-foreground/40" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                        <input type="text" value={tp.linkedinUrl || ""} placeholder="LinkedIn URL"
                          onChange={(e) => setTeamPhotos((prev) => {
                            const u = [...prev]; u[i] = { ...u[i], linkedinUrl: e.target.value || undefined }; return u;
                          })}
                          className="flex-1 min-w-0 text-[11px] text-muted-foreground bg-transparent border-none p-0 focus:outline-none placeholder:text-muted-foreground/30" />
                        {tp.linkedinUrl && (
                          <a href={tp.linkedinUrl} target="_blank" rel="noopener noreferrer"
                            className="shrink-0 text-muted-foreground/50 hover:text-[#0A66C2] transition" title="Open LinkedIn">
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                          </a>
                        )}
                      </div>
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

          {/* Row 5: Back Message */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">Back of Card Message</label>
            <div className="flex gap-2">
              <textarea value={backMessage} onChange={(e) => setBackMessage(e.target.value)}
                placeholder="Personalized message for the back of the postcard..."
                rows={2}
                className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition resize-none placeholder:text-muted-foreground/50" />
              <button onClick={handleSaveBackMessage} disabled={savingBackMessage || backMessage === (postcard.backMessage || "")}
                className="self-end px-4 py-2 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-foreground border border-border transition disabled:opacity-30">
                {savingBackMessage ? "Saving..." : "Save"}
              </button>
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
