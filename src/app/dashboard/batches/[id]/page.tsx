"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import CorrectionModal from "@/components/corrections/correction-modal";

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
  profileImageUrl: string | null;
  enrichmentId: string | null;
  enrichmentStatus: string | null;
  enrichmentBatchId: string | null;
  enrichCurrentStep: string | null;
  enrichErrorMessage: string | null;
  enrichRetryCount: number;
  enrichUpdatedAt: string | null;
  postcardId: string | null;
  postcardStatus: string | null;
  postcardBatchId: string | null;
  postcardTemplate: string | null;
  postcardUpdatedAt: string | null;
  jobUpdatedAt: string | null;
  isRemote: boolean | null;
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

function RefreshBtn({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      title="Re-run"
      className="p-0.5 rounded text-muted-foreground/50 hover:text-primary hover:bg-primary/10 transition opacity-0 group-hover/row:opacity-100"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>
  );
}

function CancelBtn({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      title="Cancel"
      className="p-0.5 rounded text-muted-foreground/50 hover:text-danger hover:bg-danger/10 transition"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

function CorrectBtn({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      title="Correct"
      className="p-0.5 rounded text-muted-foreground/50 hover:text-warning hover:bg-warning/10 transition opacity-0 group-hover/row:opacity-100"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  );
}

type CorrectionTarget = {
  contactId: string;
  contactName: string;
  stage: "scan" | "enrich" | "postcard";
  availableStages: Array<"scan" | "enrich" | "postcard">;
  postcardId?: string;
} | null;

function ScanPill({ c, onRefresh, onCorrect, onCancel }: { c: CampaignContact; onRefresh?: () => void; onCorrect?: () => void; onCancel?: () => void }) {
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
        {onCorrect && <CorrectBtn onClick={(e) => { e.stopPropagation(); onCorrect(); }} />}
        {onRefresh && <RefreshBtn onClick={(e) => { e.stopPropagation(); onRefresh(); }} />}
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
      {onCancel && <CancelBtn onClick={(e) => { e.stopPropagation(); onCancel(); }} />}
    </div>
  );
}

function EnrichPill({ c, onRefresh, onCorrect, onCancel }: { c: CampaignContact; onRefresh?: () => void; onCorrect?: () => void; onCancel?: () => void }) {
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
        {onCancel && <CancelBtn onClick={(e) => { e.stopPropagation(); onCancel(); }} />}
      </div>
    );
  }
  if (c.enrichmentStatus === "completed") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Done
        </span>
        {onCorrect && <CorrectBtn onClick={(e) => { e.stopPropagation(); onCorrect(); }} />}
        {onRefresh && <RefreshBtn onClick={(e) => { e.stopPropagation(); onRefresh(); }} />}
      </div>
    );
  }
  if (c.enrichmentStatus === "failed") {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-danger/10 text-danger">Failed</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{c.enrichmentStatus}</span>;
}

function PostcardPill({ c, onRefresh, onCorrect, onCancel }: { c: CampaignContact; onRefresh?: () => void; onCorrect?: () => void; onCancel?: () => void }) {
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
        {onCancel && <CancelBtn onClick={(e) => { e.stopPropagation(); onCancel(); }} />}
      </div>
    );
  }
  if (c.postcardStatus === "ready" || c.postcardStatus === "approved") {
    return (
      <div className="flex items-center gap-1.5">
        <Link
          href={`/dashboard/contacts/${c.contactId}?tab=postcard`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-success/10 text-success hover:bg-success/20 transition"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          View
        </Link>
        {onCorrect && <CorrectBtn onClick={(e) => { e.stopPropagation(); onCorrect(); }} />}
        {onRefresh && <RefreshBtn onClick={(e) => { e.stopPropagation(); onRefresh(); }} />}
      </div>
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
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget>(null);
  const [isProcessingStuck, setIsProcessingStuck] = useState(false);
  const [force, setForce] = useState(false);
  const [locationType, setLocationType] = useState<"all" | "remote" | "office">("all");
  const [refreshingPhotos, setRefreshingPhotos] = useState<Set<string>>(new Set());
  const [isStopping, setIsStopping] = useState(false);

  useEffect(() => {
    document.title = data?.batch?.name ? `${data.batch.name} | Campaigns | WDISTT` : "Campaign | WDISTT";
  }, [data?.batch?.name]);

  const cancelledRef   = useRef(false);
  const queueRef       = useRef<QueueItem[]>([]);
  const activeCountRef = useRef(0);
  const selectAllRef   = useRef<HTMLInputElement>(null);
  const retriedIdsRef  = useRef<Set<string>>(new Set());

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
    const anyActive =
      data.batch.status === "processing" ||
      data.contacts.some(
        (c) =>
          c.jobStatus === "running" ||
          c.enrichmentStatus === "enriching" ||
          c.enrichmentStatus === "pending" ||
          c.postcardStatus === "generating" ||
          c.postcardStatus === "pending"
      );
    if (!anyActive) return;
    const t = setInterval(fetchData, 8000);
    return () => clearInterval(t);
  }, [data, fetchData]);

  // Auto-retry: when dispatching is active and a postcard/enrichment fails,
  // automatically reset it and re-dispatch (once per item per session)
  useEffect(() => {
    if (!data || cancelledRef.current) return;
    // Only auto-retry while we have active dispatches (user initiated a run)
    if (activeCountRef.current === 0 && queueRef.current.length === 0) return;

    const retryItems: QueueItem[] = [];

    for (const c of data.contacts) {
      // Auto-retry failed postcards
      if (c.postcardStatus === "failed" && c.postcardId && !retriedIdsRef.current.has(`pc:${c.postcardId}`)) {
        retriedIdsRef.current.add(`pc:${c.postcardId}`);
        retryItems.push({ kind: "postcard", postcardId: c.postcardId });
      }
      // Auto-retry failed enrichments
      if (c.enrichmentStatus === "failed" && c.enrichmentId && !retriedIdsRef.current.has(`en:${c.enrichmentId}`)) {
        retriedIdsRef.current.add(`en:${c.enrichmentId}`);
        retryItems.push({ kind: "enrich", enrichmentId: c.enrichmentId });
      }
    }

    if (retryItems.length === 0) return;

    // Reset each failed item via its retry endpoint, then re-dispatch
    (async () => {
      for (const item of retryItems) {
        if (item.kind === "postcard") {
          await fetch(`/api/postcards/${item.postcardId}/retry`, { method: "POST" });
        } else if (item.kind === "enrich") {
          await fetch(`/api/enrichments/${item.enrichmentId}/retry`, { method: "POST" });
        }
      }
      await fetchData();
      enqueueAndDispatch(retryItems);
    })();
  }, [data, fetchData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Indeterminate state for select-all checkbox
  const allSelected = !!data && data.contacts.length > 0 && data.contacts.every((c) => selectedIds.has(c.jobId));
  const someSelected = !allSelected && selectedIds.size > 0;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  // ── Dispatcher ────────────────────────────────────────────────────────────

  // Wrap a promise with a timeout — if it doesn't resolve in `ms`, reject so the slot is freed
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Dispatch timeout")), ms);
      promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }

  async function dispatchItem(item: QueueItem): Promise<void> {
    if (cancelledRef.current) return;
    // 10-minute timeout per item — matches server maxDuration=600
    const DISPATCH_TIMEOUT = 10 * 60 * 1000;
    if (item.kind === "scan") {
      const res = await withTimeout(
        fetch(`/api/batches/${batchId}/jobs/${item.jobId}/stream`),
        DISPATCH_TIMEOUT
      );
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      while (!(await reader.read()).done) { /* consume stream */ }
    } else if (item.kind === "enrich") {
      await withTimeout(
        fetch(`/api/enrichments/${item.enrichmentId}/run`, { method: "POST" }),
        DISPATCH_TIMEOUT
      );
    } else {
      await withTimeout(
        fetch(`/api/postcards/${item.postcardId}/run`, { method: "POST" }),
        DISPATCH_TIMEOUT
      );
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
      (c) => c.jobStatus === "failed" || c.jobStatus === "cancelled" ||
             (force && c.jobStatus === "complete")
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

    // Track scan completion to call finalize when all jobs settle
    const scanItems: QueueItem[] = allJobIds.map((jobId) => ({ kind: "scan", jobId }));
    const totalScans = scanItems.length;
    let settledScans = 0;

    // Use a wrapper that tracks settlement and calls finalize when all scans are done
    const originalDispatch = dispatchItem;
    const trackingItems = scanItems.map((item) => {
      const wrappedItem = { ...item };
      return wrappedItem;
    });

    queueRef.current.push(...trackingItems);

    // Override drain temporarily to track scan settlements
    const savedDrain = drainQueue;
    function scanTrackingDrain() {
      while (activeCountRef.current < CONCURRENCY && queueRef.current.length > 0) {
        activeCountRef.current++;
        const item = queueRef.current.shift()!;
        originalDispatch(item)
          .catch(() => {})
          .finally(() => {
            activeCountRef.current--;
            fetchData();
            if (item.kind === "scan") {
              settledScans++;
              if (settledScans >= totalScans) {
                fetch(`/api/batches/${batchId}/finalize`, { method: "POST" }).catch(() => {});
              }
            }
            scanTrackingDrain();
          });
      }
    }
    scanTrackingDrain();
    void savedDrain; // suppress unused warning
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
          c.enrichmentStatus === "cancelled" ||
          (force && c.enrichmentStatus === "completed"))
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
          c.postcardStatus === "cancelled" ||
          (force && (c.postcardStatus === "ready" || c.postcardStatus === "approved")))
    );
    if (eligible.length === 0) return;

    const res = await fetch("/api/postcards/generate-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactIds: eligible.map((c) => c.contactId!),
        scanBatchId: batchId,
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

  // ── Process stuck queued items ───────────────────────────────────────────

  async function handleProcessStuck() {
    setIsProcessingStuck(true);
    try {
      const res = await fetch(`/api/campaigns/${batchId}/process-stuck`, { method: "POST" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.total === 0) return;

      await fetchData();

      const items: QueueItem[] = [
        ...((json.jobIds as string[]) ?? []).map((jobId: string) => ({ kind: "scan" as const, jobId })),
        ...((json.enrichmentIds as string[]) ?? []).map((id: string) => ({ kind: "enrich" as const, enrichmentId: id })),
        ...((json.postcardIds as string[]) ?? []).map((id: string) => ({ kind: "postcard" as const, postcardId: id })),
      ];
      enqueueAndDispatch(items);
    } finally {
      setIsProcessingStuck(false);
    }
  }

  // ── Single-contact refresh handlers ────────────────────────────────────────

  async function refreshScan(c: CampaignContact) {
    const res = await fetch(`/api/batches/${batchId}/jobs/${c.jobId}/retry`, { method: "POST" });
    if (!res.ok) return;
    await fetchData();
    enqueueAndDispatch([{ kind: "scan", jobId: c.jobId }]);
  }

  async function refreshEnrich(c: CampaignContact) {
    if (!c.contactId) return;
    const res = await fetch("/api/contacts/enrich-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: [c.contactId], scanBatchId: batchId }),
    });
    const json = await res.json();
    if (!res.ok) return;
    await fetchData();
    enqueueAndDispatch(
      (json.enrichmentIds as string[]).map((id) => ({ kind: "enrich", enrichmentId: id }))
    );
  }

  async function refreshPostcard(c: CampaignContact) {
    if (!c.contactId) return;
    const res = await fetch("/api/postcards/generate-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: [c.contactId], scanBatchId: batchId }),
    });
    const json = await res.json();
    if (!res.ok) return;
    await fetchData();
    enqueueAndDispatch(
      (json.postcardIds as string[]).map((id) => ({ kind: "postcard", postcardId: id }))
    );
  }

  async function refreshPhoto(c: CampaignContact) {
    if (!c.contactId) return;
    setRefreshingPhotos((prev) => new Set(prev).add(c.contactId!));
    try {
      const res = await fetch(`/api/contacts/${c.contactId}/refresh-photo`, { method: "POST" });
      const json = await res.json();
      if (json.profileImageUrl) {
        // Update the contact's photo in local state immediately
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            contacts: prev.contacts.map((ct) =>
              ct.contactId === c.contactId ? { ...ct, profileImageUrl: json.profileImageUrl } : ct
            ),
          };
        });
      }
    } catch {
      // silently fail
    } finally {
      setRefreshingPhotos((prev) => {
        const next = new Set(prev);
        next.delete(c.contactId!);
        return next;
      });
    }
  }

  // ── Per-item cancel handlers ────────────────────────────────────────────────

  async function cancelScan(c: CampaignContact) {
    await fetch(`/api/batches/${batchId}/jobs/${c.jobId}/cancel`, { method: "POST" });
    fetchData();
  }

  async function cancelEnrich(c: CampaignContact) {
    if (!c.enrichmentId) return;
    await fetch(`/api/enrichments/${c.enrichmentId}/cancel`, { method: "POST" });
    fetchData();
  }

  async function cancelPostcard(c: CampaignContact) {
    if (!c.postcardId) return;
    await fetch(`/api/postcards/${c.postcardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    fetchData();
  }

  // ── Stop All — cancel everything in progress ────────────────────────────────

  async function handleStopAll() {
    if (!data) return;
    setIsStopping(true);
    cancelledRef.current = true;
    queueRef.current = [];
    retriedIdsRef.current.clear();

    const promises: Promise<unknown>[] = [];

    // Cancel running scan jobs
    for (const c of data.contacts) {
      if (c.jobStatus === "running" || c.jobStatus === "pending") {
        promises.push(fetch(`/api/batches/${batchId}/jobs/${c.jobId}/cancel`, { method: "POST" }).catch(() => {}));
      }
    }

    // Cancel active enrichments
    for (const c of data.contacts) {
      if ((c.enrichmentStatus === "enriching" || c.enrichmentStatus === "pending") && c.enrichmentId) {
        promises.push(fetch(`/api/enrichments/${c.enrichmentId}/cancel`, { method: "POST" }).catch(() => {}));
      }
    }

    // Cancel active postcards
    for (const c of data.contacts) {
      if ((c.postcardStatus === "generating" || c.postcardStatus === "pending") && c.postcardId) {
        promises.push(fetch(`/api/postcards/${c.postcardId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "cancelled" }),
        }).catch(() => {}));
      }
    }

    // Also stop the scan batch itself
    promises.push(fetch(`/api/batches/${batchId}/stop`, { method: "POST" }).catch(() => {}));

    // Cancel enrichment batches
    if (data.enrichBatchId) {
      promises.push(fetch(`/api/enrichment-batches/${data.enrichBatchId}/cancel`, { method: "POST" }).catch(() => {}));
    }

    // Cancel postcard batches
    if (data.postcardBatchId) {
      promises.push(fetch(`/api/postcard-batches/${data.postcardBatchId}/cancel`, { method: "POST" }).catch(() => {}));
    }

    await Promise.allSettled(promises);
    cancelledRef.current = false;
    await fetchData();
    setIsStopping(false);
  }

  // ── Correction handler ──────────────────────────────────────────────────────

  function openCorrection(c: CampaignContact, stage: "scan" | "enrich" | "postcard") {
    if (!c.contactId) return;
    const displayName = c.contactName || c.personName || formatLinkedinSlug(c.linkedinUrl);
    const available: Array<"scan" | "enrich" | "postcard"> = [];
    if (c.jobStatus === "complete" && c.contactId) available.push("scan");
    if (c.enrichmentStatus === "completed" && c.contactId) available.push("enrich");
    if ((c.postcardStatus === "ready" || c.postcardStatus === "approved") && c.contactId) available.push("postcard");
    setCorrectionTarget({
      contactId: c.contactId,
      contactName: displayName,
      stage,
      availableStages: available,
      postcardId: c.postcardId ?? undefined,
    });
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
    c.jobStatus === "pending" || c.jobStatus === "failed" || c.jobStatus === "cancelled" ||
    (force && c.jobStatus === "complete")
  );
  const canEnrich = sel.some(
    (c) =>
      c.contactId &&
      c.jobStatus === "complete" &&
      (!c.enrichmentId ||
        c.enrichmentStatus === "failed" ||
        c.enrichmentStatus === "cancelled" ||
        (force && c.enrichmentStatus === "completed"))
  );
  const canPostcard = sel.some(
    (c) =>
      c.enrichmentStatus === "completed" &&
      (!c.postcardId ||
        c.postcardStatus === "failed" ||
        c.postcardStatus === "cancelled" ||
        (force && (c.postcardStatus === "ready" || c.postcardStatus === "approved")))
  );
  const canRunAll = canScan || canEnrich || canPostcard;

  const STALE_MS = 10 * 60 * 1000;
  const now = Date.now();
  const isStale = (ts: string | null) => ts ? now - new Date(ts).getTime() > STALE_MS : false;

  const stuckCount = contacts.filter(
    (c) =>
      c.jobStatus === "pending" ||
      c.enrichmentStatus === "pending" ||
      c.postcardStatus === "pending" ||
      (c.jobStatus === "running" && isStale(c.jobUpdatedAt)) ||
      (c.enrichmentStatus === "enriching" && isStale(c.enrichUpdatedAt)) ||
      (c.postcardStatus === "generating" && isStale(c.postcardUpdatedAt))
  ).length;

  const filteredContacts = locationType === "all"
    ? contacts
    : locationType === "remote"
      ? contacts.filter((c) => c.isRemote === true)
      : contacts.filter((c) => c.isRemote === false);
  const sortedContacts = [...filteredContacts].sort((a, b) => contactSortKey(a) - contactSortKey(b));

  // Overall active indicator
  const anyActive = contacts.some(
    (c) =>
      c.jobStatus === "running" ||
      c.enrichmentStatus === "enriching" ||
      c.postcardStatus === "generating"
  );

  return (
    <div>
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
        <div className="flex items-center gap-2 shrink-0">
          {anyActive && (
            <button
              onClick={handleStopAll}
              disabled={isStopping}
              className="inline-flex items-center gap-2 bg-danger/10 hover:bg-danger/20 text-danger border border-danger/20 px-4 py-2 rounded-lg font-medium transition text-sm disabled:opacity-50"
            >
              {isStopping ? (
                <div className="w-4 h-4 border-2 border-danger border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
              )}
              Stop All
            </button>
          )}
          <Link
            href="/dashboard/batches"
            className="border border-border hover:border-muted-foreground text-muted-foreground hover:text-foreground px-4 py-2 rounded-lg font-medium transition text-sm"
          >
            ← Campaigns
          </Link>
        </div>
      </div>

      {/* Action bar */}
      <div className="glass-card rounded-2xl px-4 py-3 mb-4 flex flex-wrap items-center gap-2">
        {/* Select All */}
        <label className="flex items-center gap-2 cursor-pointer">
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

        {/* Select by status dropdown */}
        <select
          value=""
          onChange={(e) => {
            const val = e.target.value;
            if (!val) return;
            let ids: string[] = [];
            if (val === "all") {
              ids = contacts.map((c) => c.jobId);
            } else if (val === "none") {
              setSelectedIds(new Set());
              return;
            } else if (val === "failed") {
              ids = contacts
                .filter((c) =>
                  c.jobStatus === "failed" ||
                  c.enrichmentStatus === "failed" ||
                  c.postcardStatus === "failed"
                )
                .map((c) => c.jobId);
            } else if (val === "complete") {
              ids = contacts
                .filter((c) => c.postcardStatus === "ready" || c.postcardStatus === "approved")
                .map((c) => c.jobId);
            } else if (val === "scan_complete") {
              ids = contacts.filter((c) => c.jobStatus === "complete").map((c) => c.jobId);
            } else if (val === "enrich_complete") {
              ids = contacts.filter((c) => c.enrichmentStatus === "completed").map((c) => c.jobId);
            } else if (val === "needs_scan") {
              ids = contacts
                .filter((c) =>
                  c.jobStatus === "pending" ||
                  c.jobStatus === "failed" ||
                  c.jobStatus === "cancelled"
                )
                .map((c) => c.jobId);
            } else if (val === "needs_enrich") {
              ids = contacts
                .filter(
                  (c) =>
                    c.contactId &&
                    c.jobStatus === "complete" &&
                    (!c.enrichmentId ||
                      c.enrichmentStatus === "failed" ||
                      c.enrichmentStatus === "cancelled")
                )
                .map((c) => c.jobId);
            } else if (val === "needs_postcard") {
              ids = contacts
                .filter(
                  (c) =>
                    c.enrichmentStatus === "completed" &&
                    (!c.postcardId ||
                      c.postcardStatus === "failed" ||
                      c.postcardStatus === "cancelled")
                )
                .map((c) => c.jobId);
            }
            setSelectedIds(new Set(ids));
          }}
          className="text-sm text-muted-foreground bg-transparent border border-border rounded-lg px-2 py-1.5 cursor-pointer hover:border-muted-foreground transition focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">Filter select...</option>
          <option value="all">All contacts</option>
          <option value="none">None</option>
          <option value="failed">Any failed</option>
          <option value="needs_scan">Needs scan</option>
          <option value="scan_complete">Scan complete</option>
          <option value="needs_enrich">Needs enrich</option>
          <option value="enrich_complete">Enrich complete</option>
          <option value="needs_postcard">Needs postcard</option>
          <option value="complete">Fully complete</option>
        </select>

        <div className="h-4 w-px bg-border mx-1" />

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={force}
            onChange={() => setForce(!force)}
            className="w-4 h-4 rounded border-border accent-warning cursor-pointer"
          />
          <span className="text-sm font-medium text-warning select-none">Force</span>
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

        {/* Process stuck queued items */}
        {stuckCount > 0 && (
          <>
            <div className="h-4 w-px bg-border mx-1" />
            <button
              onClick={handleProcessStuck}
              disabled={isProcessingStuck}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-warning/50 hover:border-warning text-warning hover:bg-warning/10 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {isProcessingStuck ? (
                <div className="w-3.5 h-3.5 border-2 border-warning border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              Process Stuck ({stuckCount})
            </button>
          </>
        )}

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

      {/* Location type filter */}
      <div className="flex gap-1 mb-4">
        {([
          { key: "all", label: "All" },
          { key: "remote", label: "Remote" },
          { key: "office", label: "In-Office" },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setLocationType(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
              locationType === key
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-card"
            }`}
          >
            {label}
            {key !== "all" && (
              <span className="ml-1.5 text-xs opacity-60">
                {key === "remote"
                  ? contacts.filter((c) => c.isRemote === true).length
                  : contacts.filter((c) => c.isRemote === false).length}
              </span>
            )}
          </button>
        ))}
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
            <div key={c.jobId} className="group/row grid grid-cols-[2rem_1fr_1fr_1fr_1fr] gap-3 items-center px-4 py-3 hover:bg-card-hover/50 transition">
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
                {c.profileImageUrl ? (
                  <img src={c.profileImageUrl} alt={displayName} className="w-8 h-8 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                    {initial}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                    <a
                      href={c.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-muted-foreground/50 hover:text-[#0A66C2] transition"
                      title="LinkedIn profile"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    </a>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{c.contactTitle ? `${c.contactTitle} · ` : ""}{slug}</p>
                </div>
                {c.contactId && (
                  <>
                    <button
                      onClick={() => refreshPhoto(c)}
                      disabled={refreshingPhotos.has(c.contactId!)}
                      className="shrink-0 text-muted-foreground hover:text-primary transition disabled:opacity-40"
                      title={refreshingPhotos.has(c.contactId!) ? "Finding photo..." : "Refresh photo"}
                    >
                      {refreshingPhotos.has(c.contactId!) ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      )}
                    </button>
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
                  </>
                )}
              </div>

              {/* Scan */}
              <div><ScanPill c={c} onRefresh={c.jobStatus === "complete" ? () => refreshScan(c) : undefined} onCorrect={c.jobStatus === "complete" && c.contactId ? () => openCorrection(c, "scan") : undefined} onCancel={c.jobStatus === "running" ? () => cancelScan(c) : undefined} /></div>

              {/* Enrich */}
              <div><EnrichPill c={c} onRefresh={c.enrichmentStatus === "completed" ? () => refreshEnrich(c) : undefined} onCorrect={c.enrichmentStatus === "completed" && c.contactId ? () => openCorrection(c, "enrich") : undefined} onCancel={c.enrichmentStatus === "enriching" && c.enrichmentId ? () => cancelEnrich(c) : undefined} /></div>

              {/* Postcard */}
              <div><PostcardPill c={c} onRefresh={c.postcardStatus === "ready" || c.postcardStatus === "approved" ? () => refreshPostcard(c) : undefined} onCorrect={(c.postcardStatus === "ready" || c.postcardStatus === "approved") && c.contactId ? () => openCorrection(c, "postcard") : undefined} onCancel={c.postcardStatus === "generating" && c.postcardId ? () => cancelPostcard(c) : undefined} /></div>
            </div>
          );
        })}

        {contacts.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No contacts yet. Start the scan to add contacts.
          </div>
        )}
      </div>

      {/* Correction modal */}
      {correctionTarget && (
        <CorrectionModal
          isOpen={true}
          onClose={() => setCorrectionTarget(null)}
          contactId={correctionTarget.contactId}
          contactName={correctionTarget.contactName}
          stage={correctionTarget.stage}
          availableStages={correctionTarget.availableStages}
          postcardId={correctionTarget.postcardId}
          onApplied={fetchData}
        />
      )}
    </div>
  );
}
