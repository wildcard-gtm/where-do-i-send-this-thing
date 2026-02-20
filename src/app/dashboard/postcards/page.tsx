"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Postcard {
  id: string;
  contactId: string;
  template: string;
  status: string;
  imageUrl: string | null;
  contactName: string;
  contactTitle: string | null;
  deliveryAddress: string | null;
  createdAt: string;
  contact: {
    id: string;
    name: string;
    company: string | null;
  };
}

const statusColors: Record<string, string> = {
  pending: "text-warning bg-warning/10",
  generating: "text-primary bg-primary/10",
  ready: "text-accent bg-accent/10",
  approved: "text-success bg-success/10",
  failed: "text-danger bg-danger/10",
};

const filterTabs = ["all", "pending", "generating", "ready", "approved", "failed"];

export default function PostcardsPage() {
  const [postcards, setPostcards] = useState<Postcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadPostcards = () => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    fetch(`/api/postcards?${params}`)
      .then((res) => (res.ok ? res.json() : { postcards: [] }))
      .then((data) => {
        setPostcards(data.postcards || []);
        setLoading(false);
      });
  };

  useEffect(() => {
    setLoading(true);
    loadPostcards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Poll for status changes while any postcard is in-progress
  useEffect(() => {
    const hasInProgress = postcards.some(
      (p) => p.status === "pending" || p.status === "generating"
    );
    if (!hasInProgress) return;
    const interval = setInterval(loadPostcards, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postcards]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const handleDelete = async (id: string) => {
    await fetch(`/api/postcards/${id}`, { method: "DELETE" });
    setPostcards((prev) => prev.filter((p) => p.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleExportCsv = () => {
    const rows = [
      ["Name", "Company", "Template", "Status", "Delivery Address"],
      ...postcards
        .filter((p) => selected.size === 0 || selected.has(p.id))
        .map((p) => [
          p.contactName,
          p.contact.company ?? "",
          p.template,
          p.status,
          p.deliveryAddress ?? "",
        ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "postcards-shipping.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    const targets = postcards.filter(
      (p) =>
        p.imageUrl &&
        p.status === "approved" &&
        (selected.size === 0 || selected.has(p.id))
    );
    if (targets.length === 0) {
      setActionMessage("No approved postcards with images to download.");
      return;
    }

    setActionMessage(`Preparing ZIP with ${targets.length} postcard(s)...`);

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    for (const p of targets) {
      const res = await fetch(p.imageUrl!);
      const blob = await res.blob();
      zip.file(`${p.contactName.replace(/[^a-z0-9]/gi, "_")}-postcard.png`, blob);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = "approved-postcards.zip";
    a.click();
    URL.revokeObjectURL(url);
    setActionMessage(`Downloaded ${targets.length} postcard(s).`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Postcards</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {postcards.length} postcard{postcards.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Shipping CSV
          </button>
          <button
            onClick={handleDownloadZip}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg font-medium transition text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Approved
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-primary/10 text-primary text-sm border border-primary/20">
          {actionMessage}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto">
        {filterTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap capitalize ${
              filter === tab
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-card"
            }`}
          >
            {tab === "all" ? "All" : tab}
          </button>
        ))}
      </div>

      {postcards.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">No postcards yet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Generate postcards from the contact detail page after running enrichment.
          </p>
          <Link
            href="/dashboard/contacts"
            className="bg-primary hover:bg-primary-hover text-white px-6 py-2.5 rounded-lg font-medium transition inline-block text-sm"
          >
            Go to Contacts
          </Link>
        </div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="divide-y divide-border/50">
            {postcards.map((postcard) => (
              <div
                key={postcard.id}
                className="flex items-center gap-4 px-5 py-4 hover:bg-card-hover transition"
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selected.has(postcard.id)}
                  onChange={() => toggleSelect(postcard.id)}
                  className="w-4 h-4 rounded accent-primary cursor-pointer shrink-0"
                />

                {/* Thumbnail */}
                <div className="w-20 h-14 rounded-lg overflow-hidden bg-muted shrink-0">
                  {postcard.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={postcard.imageUrl}
                      alt="Postcard"
                      className="w-full h-full object-cover"
                    />
                  ) : postcard.status === "pending" || postcard.status === "generating" ? (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                      No image
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/dashboard/postcards/${postcard.id}`}
                    className="text-sm font-medium text-foreground hover:text-primary transition truncate block"
                  >
                    {postcard.contactName}
                  </Link>
                  <p className="text-xs text-muted-foreground truncate">
                    {postcard.contact.company ?? ""}
                    {postcard.deliveryAddress ? ` · ${postcard.deliveryAddress}` : ""}
                  </p>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                    {postcard.template}
                  </span>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
                      statusColors[postcard.status] ?? "text-muted-foreground bg-muted"
                    }`}
                  >
                    {postcard.status}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {postcard.status === "ready" && (
                    <button
                      onClick={() => handleApprove(postcard.id)}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg bg-success/10 text-success hover:bg-success/20 transition"
                    >
                      Approve
                    </button>
                  )}
                  {postcard.imageUrl && (
                    <a
                      href={postcard.imageUrl}
                      download
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition"
                    >
                      Download
                    </a>
                  )}
                  <button
                    onClick={() => handleDelete(postcard.id)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-danger hover:bg-danger/10 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
