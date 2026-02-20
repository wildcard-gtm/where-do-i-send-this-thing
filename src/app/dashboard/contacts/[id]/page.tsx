"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ContactChat from "@/components/contacts/contact-chat";
import FeedbackButtons from "@/components/contacts/feedback-buttons";

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

const recommendationColors: Record<string, string> = {
  HOME: "text-success bg-success/15",
  OFFICE: "text-primary bg-primary/15",
  COURIER: "text-accent bg-accent-light",
};

const markdownProseClasses = "prose prose-sm max-w-none text-muted-foreground prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1.5 prose-p:leading-relaxed prose-ul:my-1.5 prose-ul:pl-4 prose-ol:my-1.5 prose-ol:pl-4 prose-li:my-0.5 prose-li:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold prose-code:text-foreground prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted/50 prose-pre:rounded-lg prose-pre:my-2 prose-a:text-primary prose-a:no-underline hover:prose-a:underline";

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const contactId = params.id as string;
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "chat" | "postcard">("overview");
  const [isAdmin, setIsAdmin] = useState(false);
  const [postcard, setPostcard] = useState<{
    id: string; status: string; imageUrl: string | null; template: string;
  } | null>(null);
  const [postcardGenerating, setPostcardGenerating] = useState(false);

  useEffect(() => {
    fetch(`/api/contacts/${contactId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.contact) setContact(data.contact);
        if (data?.userRole === "admin") setIsAdmin(true);
        setLoading(false);
      });
  }, [contactId]);

  // Load postcard for this contact when Postcard tab is opened
  useEffect(() => {
    if (tab !== "postcard") return;
    fetch(`/api/contacts/${contactId}/postcards`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const latest = data?.postcards?.[0] ?? null;
        setPostcard(latest);
      });
  }, [tab, contactId]);

  // Poll while postcard is generating
  useEffect(() => {
    if (!postcard) return;
    if (postcard.status !== "pending" && postcard.status !== "generating") return;
    const interval = setInterval(() => {
      fetch(`/api/postcards/${postcard.id}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.postcard) setPostcard(data.postcard);
        });
    }, 4000);
    return () => clearInterval(interval);
  }, [postcard?.id, postcard?.status]);

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
          onClick={() => router.push("/dashboard/contacts")}
          className="text-primary hover:text-primary-hover mt-4 text-sm"
        >
          Back to Contacts
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
            onClick={() => router.push("/dashboard/contacts")}
            className="text-muted-foreground hover:text-foreground transition shrink-0"
            title="Back to contacts"
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
            <h1 className="text-2xl font-bold text-foreground">{contact.name}</h1>
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
      ) : tab === "postcard" ? (
        <div className="max-w-2xl">
          <div className="glass-card rounded-2xl p-6">
            <h3 className="text-sm font-medium text-foreground mb-4">Postcard</h3>

            {!postcard ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground mb-4">
                  No postcard generated yet. Run company enrichment first, then generate a postcard.
                </p>
                <button
                  onClick={handleGeneratePostcard}
                  disabled={postcardGenerating}
                  className="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium transition text-sm mx-auto"
                >
                  {postcardGenerating ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  )}
                  Generate Postcard
                </button>
              </div>
            ) : postcard.status === "pending" || postcard.status === "generating" ? (
              <div className="flex flex-col items-center py-8 gap-3">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground capitalize">
                  {postcard.status === "pending" ? "Queued..." : "Generating background illustration..."}
                </p>
                <p className="text-xs text-muted-foreground">This takes about 30–60 seconds</p>
              </div>
            ) : postcard.status === "failed" ? (
              <div className="text-center py-6">
                <p className="text-danger text-sm font-medium mb-3">Generation failed</p>
                <button
                  onClick={handleGeneratePostcard}
                  disabled={postcardGenerating}
                  className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition text-sm"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <div>
                {postcard.imageUrl && (
                  <img
                    src={postcard.imageUrl}
                    alt="Postcard preview"
                    className="w-full rounded-lg mb-4"
                  />
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  {postcard.status === "ready" && (
                    <button
                      onClick={() => handleApprovePostcard(postcard.id)}
                      className="bg-success/10 text-success hover:bg-success/20 px-4 py-2 rounded-lg font-medium transition text-sm"
                    >
                      Approve
                    </button>
                  )}
                  {postcard.status === "approved" && (
                    <span className="text-success text-sm font-medium">Approved</span>
                  )}
                  {postcard.imageUrl && (
                    <a
                      href={postcard.imageUrl}
                      download
                      className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground transition text-sm font-medium"
                    >
                      Download
                    </a>
                  )}
                  <button
                    onClick={() => window.open(`/dashboard/postcards/${postcard.id}`, "_blank")}
                    className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground transition text-sm font-medium"
                  >
                    Full Review
                  </button>
                  <button
                    onClick={handleGeneratePostcard}
                    disabled={postcardGenerating}
                    className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 transition text-sm font-medium"
                  >
                    Regenerate
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <ContactChat
          contactId={contact.id}
          contactName={contact.name}
          initialMessages={contact.chatMessages}
        />
      )}
    </div>
  );
}
