"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import UrlPasteInput from "@/components/upload/url-paste-input";
import CsvUpload from "@/components/upload/csv-upload";
import UrlPreviewList from "@/components/upload/url-preview-list";

export default function UploadPage() {
  const router = useRouter();
  const [urls, setUrls] = useState<string[]>([]);
  const [batchName, setBatchName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function handleUrlsParsed(parsed: string[]) {
    setUrls((prev) => {
      const combined = [...prev, ...parsed];
      return [...new Set(combined)];
    });
  }

  function handleRemove(index: number) {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    const validUrls = urls.filter((url) =>
      /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/i.test(url)
    );

    if (validUrls.length === 0) {
      setError("No valid LinkedIn URLs found. Please add at least one.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: validUrls, name: batchName || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create batch");
        return;
      }

      router.push(`/dashboard/batches/${data.batchId}`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-8">
        New Scan
      </h1>

      <div className="space-y-6">
        {/* Batch name */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Scan Name (optional)
          </label>
          <input
            type="text"
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            className="w-full px-4 py-2.5 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm"
            placeholder="e.g., Q1 Marketing Prospects"
          />
        </div>

        <UrlPasteInput onUrlsParsed={handleUrlsParsed} />
        <CsvUpload onUrlsParsed={handleUrlsParsed} />
        <UrlPreviewList urls={urls} onRemove={handleRemove} />

        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-4">
          <span className="text-sm text-muted-foreground">
            {urls.length > 0
              ? `${urls.length} URL${urls.length !== 1 ? "s" : ""} ready`
              : "Add LinkedIn URLs above"}
          </span>
          <button
            onClick={handleSubmit}
            disabled={urls.length === 0 || loading}
            className="bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-lg font-medium transition text-sm"
          >
            {loading ? "Creating scan..." : "Create Scan"}
          </button>
        </div>
      </div>
    </div>
  );
}
