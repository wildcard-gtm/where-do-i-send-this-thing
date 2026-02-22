"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CampaignContact {
  jobId: string;
  jobStatus: string;
  recommendation: string | null;
  confidence: number | null;
  linkedinUrl: string;
  personName: string | null;
  stages: Array<{ type: string; toolName: string | null }>;
  contactId: string | null;
  contactName: string | null;
  contactTitle: string | null;
  enrichmentId: string | null;
  enrichmentStatus: string | null;
  enrichmentBatchId: string | null;
  enrichCurrentStep: string | null;
  enrichErrorMessage: string | null;
  enrichRetryCount: number;
  postcardId: string | null;
  postcardStatus: string | null;
  postcardBatchId: string | null;
}

interface CampaignDetail {
  batch: { id: string; name: string | null; status: string; createdAt: string };
  enrichBatchId: string | null;
  postcardBatchId: string | null;
  contacts: CampaignContact[];
}

type QueueItem =
  | { kind: "scan"; jobId: string }
  | { kind: "enrich"; enrichmentId: string }
  | { kind: "postcard"; postcardId: string };

// ─── Scan stage helpers ───────────────────────────────────────────────────────

const LEAD_STAGES = [
  { key: "profile", tools: ["enrich_linkedin_profile"], label: "Analyzing" },
  { key: "search",  tools: ["search_web"],              label: "Searching" },
  { key: "address", tools: ["search_person_address"],   label: "Locating"  },
  { key: "verify",  tools: ["verify_property", "calculate_distance"], label: "Verifying" },
  { key: "decision",tools: ["submit_decision"],         label: "Finalizing" },
];

function getJobProgress(stages: Array<{ type: string; toolName: string | null }> | undefined, status: string) {
  const completed = new Set<string>();
  let currentKey: string | null = null;
  let currentLabel = "Queued";

  if (status === "complete") {
    LEAD_STAGES.forEach((s) => completed.add(s.key));
    return { completed, currentKey: null, currentLabel: "Complete", pct: 100 };
  }
  if (status === "failed")    return { completed, currentKey: null, currentLabel: "Failed",    pct: 0 };
  if (status === "cancelled") return { completed, currentKey: null, currentLabel: "Cancelled", pct: 0 };
  if (status === "pending")   return { completed, currentKey: null, currentLabel: "Queued",    pct: 0 };

  if (!stages || stages.length === 0)
    return { completed, currentKey: "profile", currentLabel: "Starting", pct: 5 };

  for (const event of stages) {
    if (event.type === "tool_call_result" && event.toolName) {
      for (const stage of LEAD_STAGES)
        if (stage.tools.includes(event.toolName)) completed.add(stage.key);
    }
    if (event.type === "tool_call_start" && event.toolName) {
      for (const stage of LEAD_STAGES) {
        if (stage.tools.includes(event.toolName) && !completed.has(stage.key)) {
          currentKey = stage.key;
          currentLabel = stage.label;
        }
      }
    }
    if (event.type === "decision_accepted" || event.type === "complete") {
      completed.add("decision");
      currentKey = null;
      currentLabel = "Complete";
    }
    if (event.type === "error") { currentKey = null; currentLabel = "Failed"; }
  }

  if (status === "running" && !currentKey) {
    for (const stage of LEAD_STAGES) {
      if (!completed.has(stage.key)) { currentKey = stage.key; currentLabel = stage.label; break; }
    }
  }

  return { completed, currentKey, currentLabel, pct: Math.round((completed.size / LEAD_STAGES.length) * 100) };
}

function StageIcon({ stageKey }: { stageKey: string }) {
  const cls = "w-3 h-3";
  switch (stageKey) {
    case "profile":  return <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>;
    case "search":   return <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;
    case "address":  return <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
    case "verify":   return <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;
    case "decision": return <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
    default: return <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" strokeWidth={2} /></svg>;
  }
}

// ─── Per-contact stage pills ──────────────────────────────────────────────────

function ScanPill({ c }: { c: CampaignContact }) {
  const { currentKey, currentLabel, pct } = getJobProgress(c.stages, c.jobStatus);

  if (c.jobStatus === "pending") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Queued</span>;
  }
  if (c.jobStatus === "failed") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-danger/10 text-danger">Failed</span>;
  }
  if (c.jobStatus === "cancelled") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Cancelled</span>;
  }
  if (c.jobStatus === "complete") {
    const recCfg: Record<string, { cls: string; label: string }> = {
      HOME:    { cls: "bg-success/10 text-success",   label: "HOME"    },
      OFFICE:  { cls: "bg-primary/10 text-primary",   label: "OFFICE"  },
      BOTH:    { cls: "bg-accent/10 text-accent",     label: "BOTH"    },
      COURIER: { cls: "bg-warning/10 text-warning",   label: "COURIER" },
    };
    const cfg = c.recommendation ? recCfg[c.recommendation] : null;
    return (
      <div className="flex items-center gap-1.5">
        {cfg && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>
            {cfg.label}
          </span>
        )}
        {c.confidence !== null && (
          <span className={`text-xs font-medium ${
            c.confidence >= 85 ? "text-success" : c.confidence >= 75 ? "text-primary" : "text-warning"
          }`}>{c.confidence}%</span>
        )}
      </div>
    );
  }
  // running
  return (
    <div className="flex items-center gap-1.5 min-w-[110px]">
      <div className="w-4 h-4 rounded-full bg-primary/15 text-primary flex items-center justify-center animate-pulse shrink-0">
        {currentKey ? <StageIcon stageKey={currentKey} /> : <div className="w-2.5 h-2.5 border border-primary border-t-transparent rounded-full animate-spin" />}
      </div>
      <span className="text-xs font-medium text-primary whitespace-nowrap">{currentLabel}</span>
      <div className="flex-1 bg-muted rounded-full h-1 min-w-[30px]">
        <div className="bg-primary h-1 rounded-full" style={{ width: `${Math.max(pct, 8)}%` }} />
      </div>
    </div>
  );
}

function EnrichPill({ c }: { c: CampaignContact }) {
  const locked = !c.enrichmentId && c.jobStatus !== "complete";

  if (locked) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground/40">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        Enrich
      </span>
    );
  }
  if (!c.enrichmentId) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">—</span>;
  }
  if (c.enrichmentStatus === "pending") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Queued</span>;
  }
  if (c.enrichmentStatus === "enriching") {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
        <span className="text-xs font-medium text-primary truncate max-w-[100px]">
          {c.enrichCurrentStep || "Enriching"}
        </span>
      </div>
    );
  }
  if (c.enrichmentStatus === "completed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Done
      </span>
    );
  }
  if (c.enrichmentStatus === "failed") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-danger/10 text-danger">Failed</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{c.enrichmentStatus}</span>;
}

function PostcardPill({ c }: { c: CampaignContact }) {
  const locked = c.enrichmentStatus !== "completed" && !c.postcardId;

  if (locked) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground/40">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        Postcard
      </span>
    );
  }
  if (!c.postcardId) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">—</span>;
  }
  if (c.postcardStatus === "pending") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Queued</span>;
  }
  if (c.postcardStatus === "generating") {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
        <span className="text-xs font-medium text-primary">Generating</span>
      </div>
    );
  }
  if (c.postcardStatus === "ready" || c.postcardStatus === "approved") {
    return (
      <Link
        href={`/dashboard/postcards/${c.postcardId}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-success/10 text-success hover:bg-success/20 transition"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        View
      </Link>
    );
  }
  if (c.postcardStatus === "failed") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-danger/10 text-danger">Failed</span>;
  }
  if (c.postcardStatus === "cancelled") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Cancelled</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{c.postcardStatus}</span>;
}

// ─── Back-message modal ───────────────────────────────────────────────────────

const DEFAULT_BACK_MESSAGE =
  `Hi [First Name],\n\nWe came across your profile and were genuinely impressed by what you're building at [Company].\n\nWe're [Your Company] — we help teams like yours [value prop in one line]. We'd love to explore if there's a fit.\n\nGive us a shout at hello@yourcompany.com or scan the QR code to book 15 minutes.\n\nCheers,\n[Your Name]`;

function BackMessageModal({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: (message: string) => void;
  onCancel: () => void;
}) {
  const [message, setMessage] = useState(DEFAULT_BACK_MESSAGE);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col">
        <div className="flex items-start justify-between p-6 pb-4 border-b border-border/50">
          <div>
            <h2 className="text-lg font-bold text-foreground">Back-of-Card Message</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Printed on the back of all {count} postcard{count !== 1 ? "s" : ""}. Edit to match your outreach voice.
            </p>
          </div>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition ml-4 shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 border border-border rounded-lg px-3 py-2">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Use <span className="font-mono mx-1">[First Name]</span> and <span className="font-mono mx-1">[Company]</span> as placeholders.
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={12}
            className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm text-foreground font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
          />
          <p className="text-xs text-muted-foreground text-right">{message.length} characters</p>
        </div>
        <div className="flex items-center justify-end gap-3 p-6 pt-2 border-t border-border/50">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground transition">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(message.trim())}
            disabled={!message.trim()}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium transition text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Generate {count} Postcard{count !== 1 ? "s" : ""} →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLinkedinSlug(url: string): string {
  const slug = url.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "");
  const parts = slug.split("-");
  while (parts.length > 1 && /^[0-9a-f]+$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.filter((w) => w.length > 0).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function contactSortKey(c: CampaignContact): number {
  if (c.jobStatus === "running")               return 0;
  if (c.enrichmentStatus === "enriching")      return 1;
  if (c.postcardStatus === "generating")       return 2;
  if (c.jobStatus === "pending" || c.enrichmentStatus === "pending" || c.postcardStatus === "pending") return 3;
  if (c.jobStatus === "failed" || c.enrichmentStatus === "failed" || c.postcardStatus === "failed")    return 4;
  if (c.jobStatus === "cancelled")             return 5;
  return 6;
}

// ─── Main page ────────────────────────────────────────────────────────────────

const CONCURRENCY = 5;

export default function CampaignDetailPage() {
  const params = useParams();
  const batchId = params.id as string;

  const [data, setData]             = useState<CampaignDetail | null>(null);
  const [loading, setLoading]       = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDispatching, setIsDispatching] = useState(false);
  const [showBackModal, setShowBackModal] = useState(false);
  const [pendingPostcardContactIds, setPendingPostcardContactIds] = useState<string[]>([]);

  const cancelledRef   = useRef(false);
  const queueRef       = useRef<QueueItem[]>([]);
  const activeCountRef = useRef(0);
  const selectAllRef   = useRef<HTMLInputElement>(null);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${batchId}`);
    if (res.ok) {
      const json = await res.json();
      setData(json);
    }
    setLoading(false);
  }, [batchId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Poll every 3s while any operation is in progress
  useEffect(() => {
    if (!data) return;
    const anyActive = data.contacts.some(
      (c) =>
        c.jobStatus === "running" ||
        c.enrichmentStatus === "enriching" ||
        c.enrichmentStatus === "pending" ||
        c.postcardStatus === "generating" ||
        c.postcardStatus === "pending"
    );
    if (!anyActive) return;
    const t = setInterval(fetchData, 3000);
    return () => clearInterval(t);
  }, [data, fetchData]);

  // Indeterminate state for select-all checkbox
  const allSelected = !!data && data.contacts.length > 0 && data.contacts.every((c) => selectedIds.has(c.jobId));
  const someSelected = !allSelected && selectedIds.size > 0;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  // ── Dispatcher ────────────────────────────────────────────────────────────

  async function dispatchItem(item: QueueItem): Promise<void> {
    if (cancelledRef.current) return;
    if (item.kind === "scan") {
      const res = await fetch(`/api/batches/${batchId}/jobs/${item.jobId}/stream`);
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      while (!(await reader.read()).done) { /* consume stream */ }
    } else if (item.kind === "enrich") {
      await fetch(`/api/enrichments/${item.enrichmentId}/run`, { method: "POST" });
    } else {
      await fetch(`/api/postcards/${item.postcardId}/run`, { method: "POST" });
    }
  }

  function drainQueue() {
    while (activeCountRef.current < CONCURRENCY && queueRef.current.length > 0) {
      activeCountRef.current++;
      const item = queueRef.current.shift()!;
      dispatchItem(item)
        .catch(() => {})
        .finally(() => {
          activeCountRef.current--;
          fetchData();
          drainQueue();
        });
    }
  }

  function enqueueAndDispatch(items: QueueItem[]) {
    queueRef.current.push(...items);
    drainQueue();
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleScanSelected() {
    if (!data) return;
    const selected = data.contacts.filter((c) => selectedIds.has(c.jobId));
    const retryable = selected.filter(
      (c) => c.jobStatus === "failed" || c.jobStatus === "cancelled"
    );

    // Start batch if still pending
    if (data.batch.status === "pending") {
      await fetch(`/api/batches/${batchId}/start`, { method: "POST" });
    }

    // Retry failed/cancelled jobs
    const retriedIds: string[] = [];
    for (const c of retryable) {
      const res = await fetch(`/api/batches/${batchId}/jobs/${c.jobId}/retry`, { method: "POST" });
      if (res.ok) retriedIds.push(c.jobId);
    }

    const pendingIds = selected.filter((c) => c.jobStatus === "pending").map((c) => c.jobId);
    const allJobIds = [...new Set([...retriedIds, ...pendingIds])];
    if (allJobIds.length === 0) return;

    await fetchData();

    // Track scan completion to call finalize
    let remaining = allJobIds.length;
    const scanItems: QueueItem[] = allJobIds.map((jobId) => ({ kind: "scan", jobId }));
    queueRef.current.push(...scanItems);

    // Wrap drainQueue to finalize when all scans settle
    const originalDrain = drainQueue;
    void originalDrain; // suppress unused warning — using inline drain below

    while (activeCountRef.current < CONCURRENCY && queueRef.current.length > 0) {
      activeCountRef.current++;
      const item = queueRef.current.shift()!;
      dispatchItem(item)
        .catch(() => {})
        .finally(() => {
          activeCountRef.current--;
          fetchData();
          remaining--;
          if (remaining === 0) {
            fetch(`/api/batches/${batchId}/finalize`, { method: "POST" }).catch(() => {});
          }
          drainQueue();
        });
    }
  }

  async function handleEnrichSelected() {
    if (!data) return;
    const eligible = data.contacts.filter(
      (c) =>
        selectedIds.has(c.jobId) &&
        c.contactId &&
        c.jobStatus === "complete" &&
        (!c.enrichmentId ||
          c.enrichmentStatus === "failed" ||
          c.enrichmentStatus === "cancelled")
    );
    if (eligible.length === 0) return;

    const contactIds = eligible.map((c) => c.contactId!);
    const res = await fetch("/api/contacts/enrich-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds, scanBatchId: batchId }),
    });
    const json = await res.json();
    if (!res.ok) return;

    await fetchData();
    enqueueAndDispatch(
      (json.enrichmentIds as string[]).map((id) => ({ kind: "enrich", enrichmentId: id }))
    );
  }

  async function handlePostcardsSelected() {
    if (!data) return;
    const eligible = data.contacts.filter(
      (c) =>
        selectedIds.has(c.jobId) &&
        c.contactId &&
        c.enrichmentStatus === "completed" &&
        (!c.postcardId ||
          c.postcardStatus === "failed" ||
          c.postcardStatus === "cancelled")
    );
    if (eligible.length === 0) return;
    setPendingPostcardContactIds(eligible.map((c) => c.contactId!));
    setShowBackModal(true);
  }

  async function handleConfirmPostcards(backMessage: string) {
    setShowBackModal(false);
    if (pendingPostcardContactIds.length === 0) return;

    const res = await fetch("/api/postcards/generate-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactIds: pendingPostcardContactIds,
        scanBatchId: batchId,
        backMessage,
      }),
    });
    const json = await res.json();
    if (!res.ok) return;

    await fetchData();
    enqueueAndDispatch(
      (json.postcardIds as string[]).map((id) => ({ kind: "postcard", postcardId: id }))
    );
  }

  async function handleRunAll() {
    setIsDispatching(true);
    await handleScanSelected();
    await handleEnrichSelected();
    await handlePostcardsSelected(); // may show modal — that's fine
    setIsDispatching(false);
  }

  async function dispatchWithLock(fn: () => Promise<void>) {
    setIsDispatching(true);
    try { await fn(); } finally { setIsDispatching(false); }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Campaign not found.</p>
        <Link href="/dashboard/batches" className="text-primary hover:text-primary-hover mt-4 inline-block">
          Back to Campaigns
        </Link>
      </div>
    );
  }

  const { batch, contacts } = data;
  const total = contacts.length;

  const sel = contacts.filter((c) => selectedIds.has(c.jobId));
  const canScan = sel.some((c) =>
    c.jobStatus === "pending" || c.jobStatus === "failed" || c.jobStatus === "cancelled"
  );
  const canEnrich = sel.some(
    (c) =>
      c.contactId &&
      c.jobStatus === "complete" &&
      (!c.enrichmentId ||
        c.enrichmentStatus === "failed" ||
        c.enrichmentStatus === "cancelled")
  );
  const canPostcard = sel.some(
    (c) =>
      c.enrichmentStatus === "completed" &&
      (!c.postcardId ||
        c.postcardStatus === "failed" ||
        c.postcardStatus === "cancelled")
  );
  const canRunAll = canScan || canEnrich || canPostcard;

  const sortedContacts = [...contacts].sort((a, b) => contactSortKey(a) - contactSortKey(b));

  // Overall active indicator
  const anyActive = contacts.some(
    (c) =>
      c.jobStatus === "running" ||
      c.enrichmentStatus === "enriching" ||
      c.postcardStatus === "generating"
  );

  return (
    <div>
      {showBackModal && (
        <BackMessageModal
          count={pendingPostcardContactIds.length}
          onConfirm={handleConfirmPostcards}
          onCancel={() => setShowBackModal(false)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            {anyActive && <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />}
            <h1 className="text-2xl font-bold text-foreground">
              {batch.name || `Campaign ${new Date(batch.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
            </h1>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              batch.status === "processing" ? "bg-primary/15 text-primary" :
              batch.status === "complete"   ? "bg-success/15 text-success" :
              batch.status === "failed"     ? "bg-danger/15 text-danger" :
              "bg-muted text-muted-foreground"
            }`}>
              {batch.status === "processing" ? "Scanning" :
               batch.status === "complete"   ? "Complete" :
               batch.status === "failed"     ? "Failed" :
               batch.status === "cancelled"  ? "Cancelled" : "Pending"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(batch.createdAt).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric",
              hour: "2-digit", minute: "2-digit",
            })}
            {" · "}{total} contact{total !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/dashboard/batches"
          className="border border-border hover:border-muted-foreground text-muted-foreground hover:text-foreground px-4 py-2 rounded-lg font-medium transition text-sm shrink-0"
        >
          ← Campaigns
        </Link>
      </div>

      {/* Action bar */}
      <div className="glass-card rounded-2xl px-4 py-3 mb-4 flex flex-wrap items-center gap-2">
        {/* Select All */}
        <label className="flex items-center gap-2 cursor-pointer mr-2">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            onChange={() => {
              if (allSelected) setSelectedIds(new Set());
              else setSelectedIds(new Set(contacts.map((c) => c.jobId)));
            }}
            className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
          />
          <span className="text-sm text-muted-foreground select-none">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
          </span>
        </label>

        <div className="h-4 w-px bg-border mx-1" />

        <button
          onClick={() => dispatchWithLock(handleScanSelected)}
          disabled={!canScan || isDispatching}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-border hover:border-primary text-foreground hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Scan
        </button>

        <button
          onClick={() => dispatchWithLock(handleEnrichSelected)}
          disabled={!canEnrich || isDispatching}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-border hover:border-primary text-foreground hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Enrich
        </button>

        <button
          onClick={() => dispatchWithLock(handlePostcardsSelected)}
          disabled={!canPostcard || isDispatching}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-border hover:border-primary text-foreground hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Postcards
        </button>

        <button
          onClick={() => handleRunAll()}
          disabled={!canRunAll || isDispatching}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {isDispatching ? (
            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          Run All
        </button>

        {/* Export CSV — when any complete jobs */}
        {contacts.some((c) => c.jobStatus === "complete") && (
          <>
            <div className="h-4 w-px bg-border mx-1" />
            <a
              href={`/api/batches/${batchId}/export`}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-border hover:border-muted-foreground text-muted-foreground hover:text-foreground transition"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </a>
          </>
        )}
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        <div />
        <div>Contact</div>
        <div>Scan</div>
        <div>Enrich</div>
        <div>Postcard</div>
      </div>

      {/* Contact rows */}
      <div className="glass-card rounded-2xl divide-y divide-border/30 overflow-hidden">
        {sortedContacts.map((c) => {
          const displayName = c.contactName || c.personName || formatLinkedinSlug(c.linkedinUrl);
          const slug = c.linkedinUrl.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "");
          const initial = displayName[0]?.toUpperCase() || "?";

          return (
            <div key={c.jobId} className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr] gap-3 items-center px-4 py-3 hover:bg-card-hover/50 transition">
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selectedIds.has(c.jobId)}
                onChange={() => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.jobId)) next.delete(c.jobId);
                    else next.add(c.jobId);
                    return next;
                  });
                }}
                className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
              />

              {/* Contact */}
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                  {initial}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{slug}</p>
                </div>
                {c.contactId && (
                  <a
                    href={`/dashboard/contacts/${c.contactId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-primary transition"
                    title="View contact"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>

              {/* Scan */}
              <div><ScanPill c={c} /></div>

              {/* Enrich */}
              <div><EnrichPill c={c} /></div>

              {/* Postcard */}
              <div><PostcardPill c={c} /></div>
            </div>
          );
        })}

        {contacts.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No contacts yet. Start the scan to add contacts.
          </div>
        )}
      </div>
    </div>
  );
}
