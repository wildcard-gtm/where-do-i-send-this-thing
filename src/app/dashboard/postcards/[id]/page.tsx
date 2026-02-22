"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

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
}

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

  const loadPostcard = () => {
    fetch(`/api/postcards/${postcardId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.postcard) setPostcard(data.postcard);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadPostcard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postcardId]);

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

  const handleDelete = async () => {
    if (!confirm("Delete this postcard?")) return;
    await fetch(`/api/postcards/${postcardId}`, { method: "DELETE" });
    router.push("/dashboard/postcards");
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
            {postcard.imageUrl && (
              <a
                href={postcard.imageUrl}
                download
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition text-sm font-medium"
              >
                Download PNG
              </a>
            )}
            <button
              onClick={handleDelete}
              className="px-4 py-2.5 rounded-lg border border-border text-danger hover:bg-danger/10 transition text-sm font-medium"
            >
              Delete
            </button>
          </div>
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
        </div>
      </div>
    </div>
  );
}
