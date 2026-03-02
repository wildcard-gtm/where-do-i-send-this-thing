"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import CorrectionModal from "@/components/corrections/correction-modal";

interface OpenRole {
  title: string;
  location: string;
  level: string;
}

interface Postcard {
  id: string;
  contactId: string;
  template: string;
  status: string;
  errorMessage: string | null;
  backgroundUrl: string | null;
  imageUrl: string | null;
  companyLogo: string | null;
  openRoles: OpenRole[] | null;
  companyValues: string[] | null;
  companyMission: string | null;
  officeLocations: string[] | null;
  contactName: string;
  contactTitle: string | null;
  contactPhoto: string | null;
  deliveryAddress: string | null;
  createdAt: string;
  postcardHeadline: string | null;
  postcardDescription: string | null;
  accentColor: string | null;
  backMessage: string | null;
}

interface ReferenceImage {
  id: string;
  label: string;
  imageUrl: string;
}

const labelOptions = [
  { value: "prospect_photo", label: "Prospect Photo" },
  { value: "team_photo", label: "Team Photo" },
  { value: "company_logo", label: "Company Logo" },
  { value: "reference", label: "Reference" },
];

const statusColors: Record<string, string> = {
  pending: "text-warning bg-warning/10",
  generating: "text-primary bg-primary/10",
  ready: "text-accent bg-accent/10",
  approved: "text-success bg-success/10",
  failed: "text-danger bg-danger/10",
};

export default function PostcardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const postcardId = params.id as string;

  const [postcard, setPostcard] = useState<Postcard | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editHeadline, setEditHeadline] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAccentColor, setEditAccentColor] = useState("");
  const [editBackMessage, setEditBackMessage] = useState("");
  const [showCorrection, setShowCorrection] = useState(false);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [uploadLabel, setUploadLabel] = useState("reference");
  const [uploading, setUploading] = useState(false);
  const refFileInput = useRef<HTMLInputElement>(null);

  const loadPostcard = () => {
    fetch(`/api/postcards/${postcardId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.postcard) setPostcard(data.postcard);
        setLoading(false);
      });
  };

  const loadReferences = () => {
    fetch(`/api/postcards/${postcardId}/references`)
      .then((res) => (res.ok ? res.json() : { references: [] }))
      .then((data) => setReferences(data.references || []));
  };

  useEffect(() => {
    loadPostcard();
    loadReferences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postcardId]);

  // Seed edit fields when postcard first loads
  useEffect(() => {
    if (postcard) {
      setEditHeadline(postcard.postcardHeadline ?? "");
      setEditDescription(postcard.postcardDescription ?? "");
      setEditAccentColor(postcard.accentColor ?? "");
      setEditBackMessage(postcard.backMessage ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postcard?.id]);

  // Poll while generating
  useEffect(() => {
    if (!postcard) return;
    if (postcard.status !== "pending" && postcard.status !== "generating") return;
    const interval = setInterval(loadPostcard, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postcard?.status]);

  const handleApprove = async () => {
    setActionLoading(true);
    await fetch(`/api/postcards/${postcardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    setPostcard((p) => p ? { ...p, status: "approved" } : p);
    setActionLoading(false);
  };

  const handleRegenerate = async () => {
    if (!postcard) return;
    setActionLoading(true);
    // Delete current postcard and create a new one
    await fetch(`/api/postcards/${postcardId}`, { method: "DELETE" });
    const res = await fetch("/api/postcards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: postcard.contactId, template: postcard.template }),
    });
    const data = await res.json();
    if (data.postcardId) {
      // Navigate first, then kick off generation (keeps Vercel function alive via browser)
      router.push(`/dashboard/postcards/${data.postcardId}`);
      fetch(`/api/postcards/${data.postcardId}/run`, { method: "POST" }).catch(() => {});
    }
    setActionLoading(false);
  };

  const handleSaveAndRegenerate = async () => {
    setActionLoading(true);
    setShowEdit(false);
    const body: Record<string, string> = {};
    if (editHeadline.trim())     body.postcardHeadline    = editHeadline.trim();
    if (editDescription.trim())  body.postcardDescription = editDescription.trim();
    if (editAccentColor.trim())  body.accentColor         = editAccentColor.trim();
    if (editBackMessage.trim())  body.backMessage         = editBackMessage.trim();

    // PATCH resets imageUrl/backgroundUrl/status to pending automatically
    await fetch(`/api/postcards/${postcardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Kick off generation
    await fetch(`/api/postcards/${postcardId}/run`, { method: "POST" });
    loadPostcard();
    setActionLoading(false);
  };

  const handleDownload = async () => {
    if (!postcard?.imageUrl) return;
    const res = await fetch(postcard.imageUrl);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${postcard.contactName.replace(/[^a-z0-9]/gi, "_")}-postcard.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async () => {
    if (!confirm("Delete this postcard?")) return;
    await fetch(`/api/postcards/${postcardId}`, { method: "DELETE" });
    router.push("/dashboard/postcards");
  };

  const handleUploadReference = async (file: File) => {
    setUploading(true);
    const formData = new FormData();
    formData.append("postcardId", postcardId);
    formData.append("file", file);
    formData.append("label", uploadLabel);
    const res = await fetch("/api/corrections/upload", { method: "POST", body: formData });
    if (res.ok) {
      const data = await res.json();
      setReferences((prev) => [...prev, data]);
    }
    setUploading(false);
    if (refFileInput.current) refFileInput.current.value = "";
  };

  const handleDeleteReference = async (refId: string) => {
    await fetch("/api/corrections/upload", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referenceId: refId }),
    });
    setReferences((prev) => prev.filter((r) => r.id !== refId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!postcard) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Postcard not found.</p>
        <button
          onClick={() => router.push("/dashboard/postcards")}
          className="text-primary hover:text-primary-hover mt-4 text-sm"
        >
          Back to Postcards
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.push("/dashboard/postcards")}
          className="text-muted-foreground hover:text-foreground transition"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{postcard.contactName}</h1>
          <p className="text-sm text-muted-foreground capitalize">
            {postcard.template} template ·{" "}
            <span
              className={`font-medium capitalize ${
                statusColors[postcard.status]?.split(" ")[0] ?? "text-foreground"
              }`}
            >
              {postcard.status}
            </span>
          </p>
        </div>
      </div>

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
                  {postcard.status === "pending" ? "Queued for generation..." : "Generating background image..."}
                </p>
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
                onClick={handleApprove}
                disabled={actionLoading}
                className="flex items-center gap-2 bg-success hover:bg-success/80 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition text-sm"
              >
                Approve
              </button>
            )}
            <button
              onClick={handleRegenerate}
              disabled={actionLoading || postcard.status === "pending" || postcard.status === "generating"}
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-4 py-2.5 rounded-lg font-medium transition text-sm"
            >
              {actionLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : null}
              Regenerate
            </button>
            <button
              onClick={() => setShowEdit((v) => !v)}
              disabled={actionLoading || postcard.status === "pending" || postcard.status === "generating"}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 transition text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
            {postcard.imageUrl && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition text-sm font-medium"
              >
                Download PNG
              </button>
            )}
            <button
              onClick={() => setShowCorrection(true)}
              disabled={postcard.status === "pending" || postcard.status === "generating"}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-warning/50 text-warning hover:bg-warning/10 disabled:opacity-50 transition text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Correct with AI
            </button>
            <button
              onClick={handleDelete}
              className="px-4 py-2.5 rounded-lg border border-border text-danger hover:bg-danger/10 transition text-sm font-medium"
            >
              Delete
            </button>
          </div>

          {/* Edit panel */}
          {showEdit && (
            <div className="mt-4 glass-card rounded-2xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Edit Card Copy</h3>
              <p className="text-xs text-muted-foreground -mt-2">
                Override the AI-generated content. Leave a field blank to keep AI-generated text. Hit &ldquo;Save &amp; Regenerate&rdquo; to rebuild the image.
              </p>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Headline</label>
                <input
                  type="text"
                  value={editHeadline}
                  onChange={(e) => setEditHeadline(e.target.value)}
                  placeholder="AI will generate if left blank"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="AI will generate if left blank"
                  rows={3}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Accent Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editAccentColor || "#4f46e5"}
                    onChange={(e) => setEditAccentColor(e.target.value)}
                    className="w-9 h-9 rounded-lg border border-border cursor-pointer bg-background"
                  />
                  <input
                    type="text"
                    value={editAccentColor}
                    onChange={(e) => setEditAccentColor(e.target.value)}
                    placeholder="#4f46e5 (AI picks if blank)"
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Back of Card Message</label>
                <textarea
                  value={editBackMessage}
                  onChange={(e) => setEditBackMessage(e.target.value)}
                  placeholder="Message printed on the back of the postcard"
                  rows={5}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/50">
                <button
                  onClick={() => setShowEdit(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveAndRegenerate}
                  className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-5 py-2 rounded-lg font-medium transition text-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Save &amp; Regenerate
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Data panel */}
        <div className="space-y-4">
          {/* Contact */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="text-sm font-medium text-foreground mb-3">Contact</h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Name</dt>
                <dd className="text-foreground">{postcard.contactName}</dd>
              </div>
              {postcard.contactTitle && (
                <div>
                  <dt className="text-xs text-muted-foreground">Title</dt>
                  <dd className="text-foreground">{postcard.contactTitle}</dd>
                </div>
              )}
              {postcard.deliveryAddress && (
                <div>
                  <dt className="text-xs text-muted-foreground">Delivery Address</dt>
                  <dd className="text-foreground text-xs">{postcard.deliveryAddress}</dd>
                </div>
              )}
            </dl>
            <Link
              href={`/dashboard/contacts/${postcard.contactId}`}
              className="text-xs text-primary hover:underline mt-3 inline-block"
            >
              View contact &rarr;
            </Link>
          </div>

          {/* Company data used */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="text-sm font-medium text-foreground mb-3">Company Data Used</h3>
            <div className="space-y-3">
              {postcard.companyLogo && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Logo</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={postcard.companyLogo} alt="Logo" className="h-8 object-contain" />
                </div>
              )}
              {postcard.openRoles && postcard.openRoles.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Open Roles</p>
                  <ul className="space-y-1">
                    {postcard.openRoles.map((r, i) => (
                      <li key={i} className="text-xs text-foreground">
                        {r.title} <span className="text-muted-foreground">— {r.location}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {postcard.officeLocations && postcard.officeLocations.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Office Locations</p>
                  <p className="text-xs text-foreground">{postcard.officeLocations.join(", ")}</p>
                </div>
              )}
              {postcard.companyMission && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Mission</p>
                  <p className="text-xs text-foreground italic">&ldquo;{postcard.companyMission}&rdquo;</p>
                </div>
              )}
            </div>
          </div>

          {/* Reference Images */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="text-sm font-medium text-foreground mb-3">Reference Images</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Upload photos for the AI to use when correcting or regenerating this postcard.
            </p>

            {references.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {references.map((ref) => (
                  <div key={ref.id} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ref.imageUrl}
                      alt={ref.label}
                      className="w-full h-20 object-cover rounded-lg border border-border"
                    />
                    <span className="absolute bottom-1 left-1 text-[10px] font-medium bg-black/60 text-white px-1.5 py-0.5 rounded capitalize">
                      {ref.label.replace(/_/g, " ")}
                    </span>
                    <button
                      onClick={() => handleDeleteReference(ref.id)}
                      className="absolute top-1 right-1 w-5 h-5 bg-danger text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <select
                value={uploadLabel}
                onChange={(e) => setUploadLabel(e.target.value)}
                className="text-xs bg-background border border-border rounded-lg px-2 py-1.5 text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {labelOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input
                ref={refFileInput}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadReference(file);
                }}
                className="hidden"
              />
              <button
                onClick={() => refFileInput.current?.click()}
                disabled={uploading}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary transition disabled:opacity-50"
              >
                {uploading ? (
                  <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                )}
                Upload
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Correction Modal */}
      {showCorrection && (
        <CorrectionModal
          isOpen={true}
          onClose={() => setShowCorrection(false)}
          contactId={postcard.contactId}
          contactName={postcard.contactName}
          stage="postcard"
          postcardId={postcard.id}
          onApplied={() => {
            loadPostcard();
            loadReferences();
          }}
        />
      )}
    </div>
  );
}
