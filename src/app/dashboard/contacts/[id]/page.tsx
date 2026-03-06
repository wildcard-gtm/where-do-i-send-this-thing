"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ContactChat from "@/components/contacts/contact-chat";
import FeedbackButtons from "@/components/contacts/feedback-buttons";
import RegenerateModal from "@/components/postcards/regenerate-modal";
import CorrectionModal from "@/components/corrections/correction-modal";

const MapView = dynamic(() => import("@/components/results/map-view"), {
  ssr: false,
  loading: () => <div className="h-64 bg-card rounded-lg animate-pulse" />,
});

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface TeamPhoto {
  name?: string;
  photoUrl: string;
  title?: string;
  linkedinUrl?: string;
}

interface EnrichmentData {
  id: string;
  teamPhotos: TeamPhoto[] | null;
  companyName: string | null;
  companyLogo: string | null;
  openRoles: Array<{ title: string; location?: string; level?: string; url?: string }> | null;
  companyValues: string[] | null;
  companyMission: string | null;
  officeLocations: string[] | null;
}

interface Contact {
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
  job: {
    id: string;
    batchId: string;
    status: string;
    result: string | null;
  } | null;
  chatMessages: ChatMessage[];
}

/** Client-side placeholder URL detection (mirrors server-side isPlaceholderUrl) */
const PLACEHOLDER_PATTERNS = [
  'static.licdn.com/aero-v1/sc/h/',
  'static.licdn.com/sc/h/',
  '/default-avatar',
  'gravatar.com/avatar/',
  'ui-avatars.com/',
  '/ghost-',
  '/blank-profile',
];
function isPlaceholder(url: string | null | undefined): boolean {
  if (!url) return true;
  return PLACEHOLDER_PATTERNS.some(p => url.includes(p));
}

const recommendationColors: Record<string, string> = {
  HOME: "text-success bg-success/15",
  OFFICE: "text-primary bg-primary/15",
  COURIER: "text-accent bg-accent-light",
};

const markdownProseClasses = "prose prose-sm max-w-none text-muted-foreground prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1.5 prose-p:leading-relaxed prose-ul:my-1.5 prose-ul:pl-4 prose-ol:my-1.5 prose-ol:pl-4 prose-li:my-0.5 prose-li:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold prose-code:text-foreground prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted/50 prose-pre:rounded-lg prose-pre:my-2 prose-a:text-primary prose-a:no-underline hover:prose-a:underline";

interface PostcardData {
  id: string;
  status: string;
  imageUrl: string | null;
  template: string;
  errorMessage?: string | null;
  contactPhoto?: string | null;
  teamPhotos?: TeamPhoto[] | null;
  companyLogo?: string | null;
  contactName?: string;
  contactTitle?: string | null;
  openRoles?: Array<{ title: string; location?: string }> | null;
  customPrompt?: string | null;
  backMessage?: string | null;
  parentPostcardId?: string | null;
  createdAt?: string;
}

interface ReferenceImage {
  id: string;
  label: string;
  imageUrl: string;
}

const statusColors: Record<string, string> = {
  pending: "text-warning bg-warning/10",
  generating: "text-primary bg-primary/10",
  ready: "text-accent bg-accent/10",
  approved: "text-success bg-success/10",
  failed: "text-danger bg-danger/10",
};

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const contactId = params.id as string;
  const [contact, setContact] = useState<Contact | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const initialTab = (searchParams.get("tab") as "overview" | "chat" | "team" | "postcard") || "overview";
  const [tab, setTab] = useState<"overview" | "chat" | "team" | "postcard">(initialTab);
  const [isAdmin, setIsAdmin] = useState(false);
  const [postcard, setPostcard] = useState<PostcardData | null>(null);
  const [allPostcards, setAllPostcards] = useState<PostcardData[]>([]);
  const [postcardGenerating, setPostcardGenerating] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [showEditBackMessage, setShowEditBackMessage] = useState(false);
  const [editBackMessage, setEditBackMessage] = useState("");
  const [postcardActionLoading, setPostcardActionLoading] = useState(false);
  const [postcardReferences, setPostcardReferences] = useState<ReferenceImage[]>([]);
  const [showPreviousVersions, setShowPreviousVersions] = useState(false);
  const [editingTeamMember, setEditingTeamMember] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editPhoto, setEditPhoto] = useState<File | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const teamFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = contact ? `${contact.name} | Contacts | WDISTT` : "Contact | WDISTT";
  }, [contact]);

  function openTeamEdit(index: number) {
    const photos = enrichment?.teamPhotos as TeamPhoto[] | null;
    if (!photos?.[index]) return;
    setEditName(photos[index].name || "");
    setEditTitle(photos[index].title || "");
    setEditPhoto(null);
    setEditingTeamMember(index);
  }

  async function saveTeamMember() {
    if (editingTeamMember === null || !enrichment) return;
    setEditSaving(true);
    try {
      const formData = new FormData();
      formData.append("index", String(editingTeamMember));
      formData.append("name", editName);
      formData.append("title", editTitle);
      if (editPhoto) formData.append("photo", editPhoto);

      const res = await fetch(`/api/enrichments/${enrichment.id}/team-member`, {
        method: "PATCH",
        body: formData,
      });
      if (res.ok) {
        const json = await res.json();
        setEnrichment({ ...enrichment, teamPhotos: json.teamPhotos });
        setEditingTeamMember(null);
      }
    } finally {
      setEditSaving(false);
    }
  }

  useEffect(() => {
    fetch(`/api/contacts/${contactId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.contact) setContact(data.contact);
        if (data?.enrichment) setEnrichment(data.enrichment);
        if (data?.userRole === "admin") setIsAdmin(true);
        setLoading(false);
      });
  }, [contactId]);

  // Load postcards for this contact when Postcard tab is opened
  const loadPostcards = () => {
    fetch(`/api/contacts/${contactId}/postcards`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const postcards = data?.postcards ?? [];
        setAllPostcards(postcards);
        const latest = postcards[0] ?? null;
        setPostcard(latest);
        if (latest?.backMessage !== undefined) {
          setEditBackMessage(latest.backMessage ?? "");
        }
      });
  };

  const loadPostcardReferences = (postcardId: string) => {
    fetch(`/api/postcards/${postcardId}/references`)
      .then((res) => (res.ok ? res.json() : { references: [] }))
      .then((data) => setPostcardReferences(data.references || []));
  };

  useEffect(() => {
    if (tab !== "postcard") return;
    loadPostcards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, contactId]);

  useEffect(() => {
    if (postcard?.id) loadPostcardReferences(postcard.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postcard?.id]);

  // Poll while postcard is generating (pause while regenerate modal is open to avoid resetting edits)
  useEffect(() => {
    if (!postcard) return;
    if (postcard.status !== "pending" && postcard.status !== "generating") return;
    if (showRegenerateModal) return;
    const interval = setInterval(() => {
      fetch(`/api/postcards/${postcard.id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.postcard) {
            setPostcard((prev) => prev ? { ...prev, ...data.postcard } : data.postcard);
          }
        });
    }, 4000);
    return () => clearInterval(interval);
  }, [postcard?.id, postcard?.status, showRegenerateModal]);

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
      // Kick off generation (keeps Vercel function alive via browser)
      fetch(`/api/postcards/${data.postcardId}/run`, { method: "POST" }).catch(() => {});
    }
    setPostcardGenerating(false);
  };

  const handleApprovePostcard = async (id: string) => {
    setPostcardActionLoading(true);
    await fetch(`/api/postcards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    setPostcard((p) => p ? { ...p, status: "approved" } : p);
    setPostcardActionLoading(false);
  };

  const handleSaveBackMessage = async () => {
    if (!postcard) return;
    setPostcardActionLoading(true);
    setShowEditBackMessage(false);
    await fetch(`/api/postcards/${postcard.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backMessage: editBackMessage.trim() }),
    });
    setPostcard((p) => p ? { ...p, backMessage: editBackMessage.trim() } : p);
    setPostcardActionLoading(false);
  };

  const handleDownloadPostcard = async () => {
    if (!postcard?.imageUrl) return;
    const res = await fetch(postcard.imageUrl);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(contact?.name || "postcard").replace(/[^a-z0-9]/gi, "_")}-postcard.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeletePostcard = async () => {
    if (!postcard || !confirm("Delete this postcard?")) return;
    await fetch(`/api/postcards/${postcard.id}`, { method: "DELETE" });
    setPostcard(null);
    loadPostcards();
  };

  const handleRegenerated = (newPostcardId: string) => {
    setPostcard({ id: newPostcardId, status: "pending", imageUrl: null, template: postcard?.template || "warroom" });
    // Reload all postcards to show revision history
    setTimeout(loadPostcards, 1000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Contact not found.</p>
        <button
          onClick={() => router.push("/dashboard/batches")}
          className="text-primary hover:text-primary-hover mt-4 text-sm"
        >
          Back to Batches
        </button>
      </div>
    );
  }

  const jobResult = contact.job?.result ? JSON.parse(contact.job.result) : null;
  const decision = jobResult?.decision;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard/batches")}
            className="text-muted-foreground hover:text-foreground transition shrink-0"
            title="Back to Batches"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          {contact.profileImageUrl ? (
            <img
              src={contact.profileImageUrl}
              alt={contact.name}
              className="w-14 h-14 rounded-full object-cover border-2 border-border"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary">
              {contact.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">{contact.name}</h1>
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground/50 hover:text-[#0A66C2] transition shrink-0"
                title="LinkedIn profile"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              {[contact.title, contact.company].filter(Boolean).join(" at ")}
            </p>
          </div>
        </div>
        <button
          onClick={async () => {
            const res = await fetch(`/api/contacts/${contactId}/pdf`);
            if (!res.ok) return;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `wdistt_${contact.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_report.pdf`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition shrink-0"
          title="Download PDF report"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          Export PDF
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border/50">
        <button
          onClick={() => setTab("overview")}
          className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            tab === "overview"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Overview
        </button>
        <button
          onClick={() => setTab("chat")}
          className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            tab === "chat"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Chat
        </button>
        <button
          onClick={() => setTab("team")}
          className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            tab === "team"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Team
        </button>
        <button
          onClick={() => setTab("postcard")}
          className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
            tab === "postcard"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Postcard
        </button>
      </div>

      {tab === "overview" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Recommendation */}
            {contact.recommendation && (
              <div className="glass-card rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-foreground">Recommendation</h3>
                  {contact.confidence !== null && (
                    <span
                      className={`text-sm font-semibold ${
                        contact.confidence >= 85
                          ? "text-success"
                          : contact.confidence >= 75
                          ? "text-warning"
                          : "text-danger"
                      }`}
                    >
                      {contact.confidence}% confidence
                    </span>
                  )}
                </div>
                <span
                  className={`inline-block text-lg font-bold px-4 py-2 rounded-lg ${
                    recommendationColors[contact.recommendation] || "text-foreground bg-muted"
                  }`}
                >
                  Send to {contact.recommendation}
                </span>
              </div>
            )}

            {/* Addresses */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {contact.homeAddress && (
                <div className="glass-card rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                    <h4 className="text-sm font-medium text-foreground">Home</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">{contact.homeAddress}</p>
                </div>
              )}
              {contact.officeAddress && (
                <div className="glass-card rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    <h4 className="text-sm font-medium text-foreground">Office</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">{contact.officeAddress}</p>
                </div>
              )}
            </div>

            {/* Map */}
            {(contact.homeAddress || contact.officeAddress) && (
              <div className="glass-card rounded-2xl p-4">
                <MapView
                  homeAddress={contact.homeAddress || undefined}
                  officeAddress={contact.officeAddress || undefined}
                />
              </div>
            )}

            {/* Career Summary */}
            {contact.careerSummary && (
              <div className="glass-card rounded-2xl p-6">
                <h3 className="text-sm font-medium text-foreground mb-3">Background</h3>
                <div className={markdownProseClasses}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {contact.careerSummary}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* Report */}
            {decision?.reasoning && (
              <div className="glass-card rounded-2xl p-6">
                <h3 className="text-sm font-medium text-foreground mb-3">Report</h3>
                <div className={markdownProseClasses}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {decision.reasoning}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {/* Feedback */}
            <div className="glass-card rounded-2xl p-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Was this report helpful?</h3>
              <FeedbackButtons contactId={contactId} />
            </div>
          </div>

          {/* Right column - Details */}
          <div className="space-y-6">
            <div className="glass-card rounded-2xl p-5">
              <h3 className="text-sm font-medium text-foreground mb-4">Details</h3>
              <dl className="space-y-3">
                {contact.email && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Email</dt>
                    <dd className="text-sm text-foreground">{contact.email}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">LinkedIn</dt>
                  <dd className="text-sm text-primary truncate">
                    <a
                      href={contact.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {contact.linkedinUrl.replace(
                        /^https?:\/\/(www\.)?linkedin\.com\/in\//,
                        ""
                      ).replace(/\/$/, "")}
                    </a>
                  </dd>
                </div>
                {contact.lastScannedAt && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Last Scanned</dt>
                    <dd className="text-sm text-foreground">
                      {new Date(contact.lastScannedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">Added</dt>
                  <dd className="text-sm text-foreground">
                    {new Date(contact.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </dd>
                </div>
              </dl>
            </div>

            {contact.job && (
              <div className="glass-card rounded-2xl p-5">
                <h3 className="text-sm font-medium text-foreground mb-3">Scan Info</h3>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Status</dt>
                    <dd className={`font-medium ${contact.job.status === "complete" ? "text-success" : contact.job.status === "failed" ? "text-danger" : "text-primary"}`}>
                      {contact.job.status === "complete" ? "Completed" : contact.job.status === "failed" ? "Failed" : "Processing"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Scan</dt>
                    <dd>
                      <button
                        onClick={() => router.push(`/dashboard/batches/${contact.job!.batchId}`)}
                        className="text-primary hover:text-primary-hover text-sm transition"
                      >
                        View batch &rarr;
                      </button>
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {/* Logs — admin only */}
            {isAdmin && contact.notes && (
              <div className="glass-card rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-medium text-foreground">Logs</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">admin only</span>
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                  {contact.notes}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : tab === "team" ? (
        <div className="max-w-2xl">
          {enrichment && (enrichment.teamPhotos as TeamPhoto[] | null)?.length ? (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Team members at <span className="font-medium text-foreground">{enrichment.companyName || contact.company || "this company"}</span> discovered during enrichment.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(enrichment.teamPhotos as TeamPhoto[]).map((tp, i) => (
                  <div key={i} className="glass-card rounded-2xl p-4 flex items-center gap-4 group/card">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0 overflow-hidden">
                      {tp.photoUrl
                        ? <img src={tp.photoUrl} alt={tp.name || "Team member"} className="w-12 h-12 rounded-full object-cover" />
                        : (tp.name || "?")[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-foreground truncate">{tp.name || "Unknown"}</p>
                        {tp.linkedinUrl && (
                          <a
                            href={tp.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-muted-foreground/50 hover:text-[#0A66C2] transition"
                            title="LinkedIn profile"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                          </a>
                        )}
                      </div>
                      {tp.title && <p className="text-xs text-muted-foreground truncate">{tp.title}</p>}
                    </div>
                    <button
                      onClick={() => openTeamEdit(i)}
                      className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition opacity-0 group-hover/card:opacity-100"
                      title="Edit team member"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              {enrichment.companyMission && (
                <div className="glass-card rounded-2xl p-6">
                  <h3 className="text-sm font-medium text-foreground mb-2">Mission</h3>
                  <p className="text-sm text-muted-foreground">{enrichment.companyMission}</p>
                </div>
              )}
              {(enrichment.companyValues as string[] | null)?.length ? (
                <div className="glass-card rounded-2xl p-6">
                  <h3 className="text-sm font-medium text-foreground mb-3">Values</h3>
                  <div className="flex flex-wrap gap-2">
                    {(enrichment.companyValues as string[]).map((v, i) => (
                      <span key={i} className="text-sm px-3 py-1 rounded-full bg-primary/10 text-primary">{v}</span>
                    ))}
                  </div>
                </div>
              ) : null}
              {(enrichment.officeLocations as string[] | null)?.length ? (
                <div className="glass-card rounded-2xl p-6">
                  <h3 className="text-sm font-medium text-foreground mb-3">Office Locations</h3>
                  <div className="flex flex-wrap gap-2">
                    {(enrichment.officeLocations as string[]).map((loc, i) => (
                      <span key={i} className="text-sm px-3 py-1 rounded-full bg-muted text-muted-foreground">{loc}</span>
                    ))}
                  </div>
                </div>
              ) : null}
              {(enrichment.openRoles as Array<{ title: string; location?: string; url?: string }> | null)?.length ? (
                <div className="glass-card rounded-2xl p-6">
                  <h3 className="text-sm font-medium text-foreground mb-3">Open Roles</h3>
                  <div className="space-y-2">
                    {(enrichment.openRoles as Array<{ title: string; location?: string; url?: string }>).slice(0, 10).map((role, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-foreground font-medium truncate">{role.title}</span>
                        {role.location && <span className="text-muted-foreground shrink-0 ml-3">{role.location}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="glass-card rounded-2xl p-12 text-center">
              <div className="w-14 h-14 bg-muted/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">No team data yet</h2>
              <p className="text-sm text-muted-foreground">Enrich this contact to discover teammates, company values, open roles, and more.</p>
            </div>
          )}
        </div>
      ) : tab === "postcard" ? (
        <div>
          {!postcard ? (
            <div className="glass-card rounded-2xl p-12 text-center max-w-lg mx-auto">
              <div className="w-14 h-14 bg-muted/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">No postcard yet</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Run company enrichment first, then generate a postcard.
              </p>
              <button
                onClick={handleGeneratePostcard}
                disabled={postcardGenerating}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium transition text-sm"
              >
                {postcardGenerating ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : null}
                Generate Postcard
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Preview */}
              <div className="lg:col-span-2">
                <div className="glass-card rounded-2xl overflow-hidden">
                  {postcard.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={postcard.imageUrl}
                      alt="Postcard preview"
                      className="w-full"
                    />
                  ) : postcard.status === "pending" || postcard.status === "generating" ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3">
                      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <p className="text-sm text-muted-foreground capitalize">
                        {postcard.status === "pending" ? "Queued for generation..." : "Generating illustration..."}
                      </p>
                      <p className="text-xs text-muted-foreground">This takes about 30-60 seconds</p>
                      {postcard.status === "generating" && (
                        <button
                          onClick={async () => {
                            await fetch(`/api/postcards/${postcard.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: "cancelled" }),
                            });
                          }}
                          className="text-xs text-muted-foreground hover:text-danger transition"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  ) : postcard.status === "failed" ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3 p-6">
                      <p className="text-danger font-medium">Generation failed</p>
                      {postcard.errorMessage && (
                        <p className="text-xs text-muted-foreground text-center">{postcard.errorMessage}</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-64">
                      <p className="text-muted-foreground text-sm">No image available</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 mt-4 flex-wrap">
                  {postcard.status === "ready" && (
                    <button
                      onClick={() => handleApprovePostcard(postcard.id)}
                      disabled={postcardActionLoading}
                      className="flex items-center gap-2 bg-success hover:bg-success/80 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition text-sm"
                    >
                      Approve
                    </button>
                  )}
                  {postcard.status === "approved" && (
                    <span className="inline-flex items-center gap-1.5 text-success text-sm font-medium px-3 py-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Approved
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      // Re-fetch latest enrichment + contact data (may have been updated by Chrome extension)
                      const res = await fetch(`/api/contacts/${contactId}`);
                      if (res.ok) {
                        const data = await res.json();
                        if (data.enrichment) setEnrichment(data.enrichment);
                        if (data.contact) setContact(data.contact);
                      }
                      setShowRegenerateModal(true);
                    }}
                    disabled={postcardActionLoading || postcard.status === "pending" || postcard.status === "generating"}
                    className="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition text-sm"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={() => setShowEditBackMessage((v) => !v)}
                    disabled={postcardActionLoading || postcard.status === "pending" || postcard.status === "generating"}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 transition text-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit Back
                  </button>
                  {postcard.imageUrl && (
                    <button
                      onClick={handleDownloadPostcard}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition text-sm font-medium"
                    >
                      Download PNG
                    </button>
                  )}
                  <button
                    onClick={() => setShowCorrectionModal(true)}
                    disabled={postcard.status === "pending" || postcard.status === "generating"}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-warning/50 text-warning hover:bg-warning/10 disabled:opacity-50 transition text-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Correct with AI
                  </button>
                  <button
                    onClick={handleDeletePostcard}
                    className="px-4 py-2.5 rounded-lg border border-border text-danger hover:bg-danger/10 transition text-sm font-medium"
                  >
                    Delete
                  </button>
                </div>

                {/* Edit back message panel */}
                {showEditBackMessage && (
                  <div className="mt-4 glass-card rounded-2xl p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">Edit Back Message</h3>
                    <p className="text-xs text-muted-foreground -mt-2">
                      Edit the message printed on the back of the physical postcard.
                    </p>
                    <textarea
                      value={editBackMessage}
                      onChange={(e) => setEditBackMessage(e.target.value)}
                      placeholder="Message printed on the back of the postcard"
                      rows={5}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition resize-none"
                    />
                    <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/50">
                      <button
                        onClick={() => setShowEditBackMessage(false)}
                        className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveBackMessage}
                        className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-5 py-2 rounded-lg font-medium transition text-sm"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}

                {/* Previous Versions */}
                {allPostcards.length > 1 && (
                  <div className="mt-6">
                    <button
                      onClick={() => setShowPreviousVersions((v) => !v)}
                      className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${showPreviousVersions ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      Previous Versions ({allPostcards.length - 1})
                    </button>
                    {showPreviousVersions && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-3">
                        {allPostcards.slice(1).map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setPostcard(p)}
                            className={`group relative rounded-xl overflow-hidden border-2 transition ${
                              postcard.id === p.id ? "border-primary" : "border-border hover:border-primary/50"
                            }`}
                          >
                            {p.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={p.imageUrl}
                                alt="Previous version"
                                className="w-full h-20 object-cover"
                              />
                            ) : (
                              <div className="w-full h-20 bg-muted/50 flex items-center justify-center">
                                <span className="text-xs text-muted-foreground capitalize">{p.status}</span>
                              </div>
                            )}
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                              <span className="text-[10px] text-white/90">
                                {p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Sidebar */}
              <div className="space-y-4">
                {/* Status */}
                <div className="glass-card rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-foreground">Status</h3>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${statusColors[postcard.status] || "text-foreground bg-muted"}`}>
                      {postcard.status}
                    </span>
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Template</dt>
                      <dd className="text-foreground capitalize">{postcard.template === "warroom" ? "War Room" : "Zoom Room"}</dd>
                    </div>
                    {postcard.createdAt && (
                      <div>
                        <dt className="text-xs text-muted-foreground">Created</dt>
                        <dd className="text-foreground">
                          {new Date(postcard.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>

                {/* Reference Images */}
                {postcardReferences.length > 0 && (
                  <div className="glass-card rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-foreground mb-3">Reference Images</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {postcardReferences.map((ref) => (
                        <div key={ref.id} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={ref.imageUrl}
                            alt={ref.label}
                            className="w-full h-20 object-cover rounded-lg border border-border"
                          />
                          <span className="absolute bottom-1 left-1 text-[10px] font-medium bg-black/60 text-white px-1.5 py-0.5 rounded capitalize">
                            {ref.label.replace(/_/g, " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Data snapshot */}
                {(postcard.contactPhoto || postcard.companyLogo || (postcard.teamPhotos as TeamPhoto[] | null)?.length) && (
                  <div className="glass-card rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-foreground mb-3">Data Used</h3>
                    <div className="space-y-3">
                      {postcard.contactPhoto && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Prospect Photo</p>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={postcard.contactPhoto} alt="Prospect" className="w-10 h-10 rounded-full object-cover" />
                        </div>
                      )}
                      {postcard.companyLogo && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Logo</p>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={postcard.companyLogo} alt="Logo" className="h-8 object-contain" />
                        </div>
                      )}
                      {(postcard.teamPhotos as TeamPhoto[] | null)?.length ? (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Team ({(postcard.teamPhotos as TeamPhoto[]).length})</p>
                          <div className="flex -space-x-2">
                            {(postcard.teamPhotos as TeamPhoto[]).slice(0, 4).map((tp, i) => (
                              tp.photoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={i} src={tp.photoUrl} alt={tp.name || ""} className="w-8 h-8 rounded-full object-cover border-2 border-card" />
                              ) : (
                                <div key={i} className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary border-2 border-card">
                                  {(tp.name || "?")[0]?.toUpperCase()}
                                </div>
                              )
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      Switch to the <button onClick={() => setTab("team")} className="text-primary hover:underline">Team tab</button> to see all team members and enrichment data.
                    </p>
                  </div>
                )}

                {/* Back message preview */}
                {postcard.backMessage && (
                  <div className="glass-card rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-foreground mb-2">Back Message</h3>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{postcard.backMessage}</p>
                  </div>
                )}

                {/* Custom prompt used */}
                {postcard.customPrompt && (
                  <div className="glass-card rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-foreground mb-2">Custom Instructions Used</h3>
                    <p className="text-xs text-muted-foreground italic">&ldquo;{postcard.customPrompt}&rdquo;</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Regeneration Modal */}
          {showRegenerateModal && postcard && (
            <RegenerateModal
              isOpen={true}
              onClose={() => setShowRegenerateModal(false)}
              contactId={contactId}
              contactName={contact?.name || ""}
              contactTitle={contact?.title ?? postcard.contactTitle ?? null}
              contactCompany={enrichment?.companyName ?? contact?.company}
              contactLinkedinUrl={contact?.linkedinUrl}
              currentPostcardId={postcard.id}
              currentTemplate={postcard.template}
              currentContactPhoto={
                isPlaceholder(postcard.contactPhoto) && contact?.profileImageUrl
                  ? contact.profileImageUrl
                  : postcard.contactPhoto ?? contact?.profileImageUrl ?? null
              }
              currentCompanyLogo={enrichment?.companyLogo ?? postcard.companyLogo ?? null}
              currentTeamPhotos={(() => {
                const postcardTeam = (postcard.teamPhotos as TeamPhoto[] | null) ?? [];
                const enrichTeam = enrichment?.teamPhotos ?? [];
                if (enrichTeam.length > 0) {
                  // Merge: for each member, prefer enrichment photo if postcard has placeholder
                  return enrichTeam.map((et, i) => {
                    const pt = postcardTeam[i];
                    if (!pt) return et;
                    return {
                      ...et,
                      photoUrl: isPlaceholder(pt.photoUrl) ? et.photoUrl : pt.photoUrl,
                    };
                  });
                }
                return postcardTeam.length > 0 ? postcardTeam : null;
              })()}
              currentOpenRoles={(postcard.openRoles as Array<{ title: string; location?: string }> | null) ?? (enrichment?.openRoles as Array<{ title: string; location?: string }> | null) ?? null}
              onRegenerated={handleRegenerated}
            />
          )}

          {/* Correction Modal */}
          {showCorrectionModal && postcard && (
            <CorrectionModal
              isOpen={true}
              onClose={() => setShowCorrectionModal(false)}
              contactId={contactId}
              contactName={contact?.name || ""}
              stage="postcard"
              postcardId={postcard.id}
              onApplied={() => {
                loadPostcards();
                loadPostcardReferences(postcard.id);
              }}
            />
          )}
        </div>
      ) : (
        <ContactChat
          contactId={contact.id}
          contactName={contact.name}
          initialMessages={contact.chatMessages}
        />
      )}
      {/* Team member edit modal */}
      {editingTeamMember !== null && enrichment && (enrichment.teamPhotos as TeamPhoto[])?.[editingTeamMember] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingTeamMember(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4">Edit Team Member</h3>

            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                {editPhoto ? (
                  <img src={URL.createObjectURL(editPhoto)} alt="Preview" className="w-16 h-16 rounded-full object-cover" />
                ) : (enrichment.teamPhotos as TeamPhoto[])[editingTeamMember].photoUrl ? (
                  <img src={(enrichment.teamPhotos as TeamPhoto[])[editingTeamMember].photoUrl} alt="Current" className="w-16 h-16 rounded-full object-cover" />
                ) : (
                  <span className="text-lg font-bold text-primary">{(editName || "?")[0]?.toUpperCase()}</span>
                )}
              </div>
              <div>
                <input ref={teamFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => setEditPhoto(e.target.files?.[0] || null)} />
                <button
                  onClick={() => teamFileRef.current?.click()}
                  className="text-xs text-primary hover:underline"
                >
                  Upload new photo
                </button>
                {editPhoto && (
                  <p className="text-xs text-muted-foreground mt-1 truncate max-w-[150px]">{editPhoto.name}</p>
                )}
              </div>
            </div>

            <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-muted/50 border border-border text-sm text-foreground mb-3 focus:outline-none focus:ring-1 focus:ring-primary"
            />

            <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-muted/50 border border-border text-sm text-foreground mb-4 focus:outline-none focus:ring-1 focus:ring-primary"
            />

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingTeamMember(null)}
                className="px-4 py-2 text-sm rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition"
              >
                Cancel
              </button>
              <button
                onClick={saveTeamMember}
                disabled={editSaving}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50"
              >
                {editSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
