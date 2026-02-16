"use client";

import { useState, useEffect } from "react";
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
  const [autoProcess, setAutoProcess] = useState(false);
  const [autoProcessLoaded, setAutoProcessLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setAutoProcess(data.user.autoProcess ?? false);
        }
        setAutoProcessLoaded(true);
      });
  }, []);

  function handleUrlsParsed(parsed: string[]) {
    setUrls((prev) => {
      const combined = [...prev, ...parsed];
      return [...new Set(combined)];
    });
  }

  function handleRemove(index: number) {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleToggleAutoProcess() {
    const newValue = !autoProcess;
    setAutoProcess(newValue);
    await fetch("/api/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoProcess: newValue }),
    });
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
        body: JSON.stringify({
          urls: validUrls,
          name: batchName || undefined,
          autoProcess,
        }),
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
            className="w-full px-4 py-2.5 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus-glow text-sm"
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

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pt-4 gap-4">
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {urls.length > 0
                ? `${urls.length} URL${urls.length !== 1 ? "s" : ""} ready`
                : "Add LinkedIn URLs above"}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {autoProcessLoaded && (
              <button
                type="button"
                onClick={handleToggleAutoProcess}
                className="flex items-center gap-2.5 group"
              >
                <div
                  className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${
                    autoProcess ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                      autoProcess ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </div>
                <span className="text-sm text-muted-foreground group-hover:text-foreground transition whitespace-nowrap">
                  Auto-process
                </span>
              </button>
            )}
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
    </div>
  );
}
