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
    linkedinUrl: string;
  };
}

interface Campaign {
  id: string;
  name: string | null;
  createdAt: string;
}

const statusColors: Record<string, string> = {
  ready: "text-accent bg-accent/10",
  approved: "text-success bg-success/10",
};

export default function PostcardsPage() {
  const [postcards, setPostcards] = useState<Postcard[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [templateFilter, setTemplateFilter] = useState<"all" | "warroom" | "zoom">("all");
  const [campaignId, setCampaignId] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  // Older versions modal
  const [versionsContactId, setVersionsContactId] = useState<string | null>(null);
  const [olderVersions, setOlderVersions] = useState<Postcard[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  useEffect(() => { document.title = "Postcards | WDISTT"; }, []);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((res) => (res.ok ? res.json() : { campaigns: [] }))
      .then((data) => setCampaigns(data.campaigns || []));
  }, []);

  const loadPostcards = () => {
    const params = new URLSearchParams({ latestOnly: "true" });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (campaignId !== "all") params.set("campaignId", campaignId);
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
  }, [statusFilter, campaignId]);

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

  const handleDownloadSingle = async (p: Postcard) => {
    if (!p.imageUrl) return;
    const res = await fetch(p.imageUrl);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.contactName.replace(/[^a-z0-9]/gi, "_")}-postcard.png`;
    a.click();
    URL.revokeObjectURL(url);
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

  // Show older versions for a contact
  const openVersions = async (contactId: string) => {
    setVersionsContactId(contactId);
    setVersionsLoading(true);
    const res = await fetch(`/api/postcards?contactId=${contactId}&includeAll=true`);
    const data = res.ok ? await res.json() : { postcards: [] };
    // Exclude the current (latest ready/approved) — show all others
    const current = postcards.find((p) => p.contactId === contactId);
    setOlderVersions(
      (data.postcards || []).filter((p: Postcard) => p.id !== current?.id && (p.status === "ready" || p.status === "approved"))
    );
    setVersionsLoading(false);
  };

  // Restore an older postcard as the "current" by approving it and un-approving the current one
  const handleRestore = async (oldPostcard: Postcard) => {
    // Set the old one to "ready" (or keep its current status) — user can then approve it
    // The gallery already shows the latest by createdAt, so we update the old one's updatedAt
    await fetch(`/api/postcards/${oldPostcard.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    // Demote the current one back to "ready"
    const current = postcards.find((p) => p.contactId === oldPostcard.contactId);
    if (current && current.id !== oldPostcard.id) {
      await fetch(`/api/postcards/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ready" }),
      });
    }
    setVersionsContactId(null);
    loadPostcards();
  };

  const filteredPostcards = templateFilter === "all"
    ? postcards
    : postcards.filter((p) => p.template === templateFilter);

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
            {filteredPostcards.length} postcard{filteredPostcards.length !== 1 ? "s" : ""}
            {templateFilter !== "all" && ` (${postcards.length} total)`}
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

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 overflow-x-auto">
        <div className="flex gap-1">
          {(["all", "ready", "approved"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
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
              onClick={() => setTemplateFilter(key)}
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
          onChange={(e) => setCampaignId(e.target.value)}
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

      {filteredPostcards.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {templateFilter !== "all" ? `No ${templateFilter === "warroom" ? "War Room" : "Zoom Room"} postcards` : "No postcards yet"}
          </h2>
          <p className="text-muted-foreground text-sm mb-6">
            {templateFilter !== "all" ? "Try a different filter." : "Generate postcards from the contact detail page after running enrichment."}
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
            {filteredPostcards.map((postcard) => (
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
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                      No image
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/dashboard/contacts/${postcard.contactId}?tab=postcard`}
                      className="text-sm font-medium text-foreground hover:text-primary transition truncate"
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
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    </a>
                  </div>
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
                  <button
                    onClick={() => openVersions(postcard.contactId)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition"
                    title="View older versions"
                  >
                    Versions
                  </button>
                  {postcard.imageUrl && (
                    <button
                      onClick={() => handleDownloadSingle(postcard)}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition"
                    >
                      Download
                    </button>
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

      {/* Older Versions Modal */}
      {versionsContactId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setVersionsContactId(null)}>
          <div className="bg-card rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Older Versions</h2>
                <button onClick={() => setVersionsContactId(null)} className="text-muted-foreground hover:text-foreground transition text-xl">&times;</button>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Select an older postcard to restore it as the current version.</p>
            </div>
            <div className="p-6">
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
                        <div className="text-xs text-muted-foreground">
                          {new Date(v.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </div>
                        <button
                          onClick={() => handleRestore(v)}
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
    </div>
  );
}
