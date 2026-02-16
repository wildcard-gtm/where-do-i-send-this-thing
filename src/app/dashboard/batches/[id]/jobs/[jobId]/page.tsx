"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";

const MapView = dynamic(() => import("@/components/results/map-view"), {
  ssr: false,
  loading: () => (
    <div className="h-64 bg-card rounded-lg animate-pulse" />
  ),
});

interface AgentEvent {
  type: string;
  timestamp: string;
  iteration?: number;
  data: Record<string, unknown>;
}

interface AddressInfo {
  address: string;
  confidence: number;
  reasoning: string;
}

interface AgentDecision {
  recommendation: string;
  confidence: number;
  reasoning: string;
  home_address?: AddressInfo;
  office_address?: AddressInfo;
  flags?: string[];
}

interface AgentResult {
  input: string;
  iterations: number;
  decision: AgentDecision | null;
  timestamp: string;
}

interface Job {
  id: string;
  linkedinUrl: string;
  personName: string | null;
  status: string;
  recommendation: string | null;
  confidence: number | null;
  result: AgentResult | null;
  events: AgentEvent[];
}

// ─── Friendly stage mapping ──────────────────────────────

const STAGE_ICONS: Record<string, { label: string; icon: React.ReactNode }> = {
  enrich_linkedin_profile: {
    label: "Looking up profile",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  search_person_address: {
    label: "Searching addresses",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  search_web: {
    label: "Researching online",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  verify_property: {
    label: "Verifying property",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  calculate_distance: {
    label: "Checking location",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  submit_decision: {
    label: "Finalizing result",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
};

const PROGRESS_STAGES = [
  { key: "profile", label: "Profile Lookup", icon: STAGE_ICONS.enrich_linkedin_profile.icon },
  { key: "search", label: "Online Research", icon: STAGE_ICONS.search_web.icon },
  { key: "address", label: "Address Search", icon: STAGE_ICONS.search_person_address.icon },
  { key: "verify", label: "Verification", icon: STAGE_ICONS.verify_property.icon },
  { key: "decision", label: "Final Result", icon: STAGE_ICONS.submit_decision.icon },
];

function toolToStageKey(toolName: string): string | null {
  switch (toolName) {
    case "enrich_linkedin_profile": return "profile";
    case "search_web": return "search";
    case "search_person_address": return "address";
    case "verify_property":
    case "calculate_distance": return "verify";
    case "submit_decision": return "decision";
    default: return null;
  }
}

function getCompletedStages(events: AgentEvent[]): Set<string> {
  const completed = new Set<string>();
  for (const e of events) {
    if (e.type === "tool_call_result") {
      const k = toolToStageKey(String(e.data.toolName));
      if (k) completed.add(k);
    }
    if (e.type === "decision_accepted" || e.type === "complete") {
      completed.add("decision");
    }
  }
  return completed;
}

function getCurrentStage(events: AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "tool_call_start") {
      return toolToStageKey(String(events[i].data.toolName));
    }
  }
  return null;
}

function buildActivityFeed(events: AgentEvent[]): Array<{ label: string; icon: React.ReactNode; status: "done" | "active" | "failed"; time: string }> {
  const feed: Array<{ label: string; icon: React.ReactNode; status: "done" | "active" | "failed"; time: string }> = [];

  for (const e of events) {
    if (e.type === "tool_call_start") {
      const mapped = STAGE_ICONS[String(e.data.toolName)];
      if (mapped) {
        feed.push({
          label: mapped.label,
          icon: mapped.icon,
          status: "active",
          time: safeTime(e.timestamp),
        });
      }
    } else if (e.type === "tool_call_result") {
      for (let i = feed.length - 1; i >= 0; i--) {
        if (feed[i].status === "active") {
          feed[i].status = e.data.success ? "done" : "failed";
          break;
        }
      }
    } else if (e.type === "decision_accepted") {
      feed.push({
        label: "Address verified",
        icon: STAGE_ICONS.submit_decision.icon,
        status: "done",
        time: safeTime(e.timestamp),
      });
    } else if (e.type === "error") {
      feed.push({
        label: "An error occurred",
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        status: "failed",
        time: safeTime(e.timestamp),
      });
    }
  }

  return feed;
}

function safeTime(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

export default function JobDetailPage() {
  const params = useParams();
  const batchId = params.id as string;
  const jobId = params.jobId as string;

  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchJob = useCallback(async () => {
    const res = await fetch(`/api/batches/${batchId}/jobs/${jobId}`);
    if (res.ok) {
      const data = await res.json();
      setJob(data.job);
      if (data.job.events?.length > 0) {
        setEvents(data.job.events);
      }
    }
  }, [batchId, jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  useEffect(() => {
    if (!job) return;
    if (job.status !== "running") return;

    setStreaming(true);
    const source = new EventSource(
      `/api/batches/${batchId}/jobs/${jobId}/stream`
    );

    source.onmessage = (e) => {
      const event: AgentEvent = JSON.parse(e.data);
      setEvents((prev) => [...prev, event]);

      if (event.type === "complete" || event.type === "error") {
        setStreaming(false);
        source.close();
        fetchJob();
      }
    };

    source.onerror = () => {
      setStreaming(false);
      source.close();
    };

    return () => source.close();
  }, [job?.status, batchId, jobId, fetchJob]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const decision = job.result?.decision;
  const completedStages = getCompletedStages(events);
  const currentStage = getCurrentStage(events);
  const activityFeed = buildActivityFeed(events);
  const isRunning = job.status === "running" || streaming;
  const isComplete = job.status === "complete";
  const isFailed = job.status === "failed";

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-foreground">
              {job.personName || "Lookup Details"}
            </h1>
            <StatusBadge status={job.status} />
          </div>
          <a
            href={job.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline mt-1 inline-block"
          >
            View LinkedIn Profile
          </a>
        </div>
        <Link
          href={`/dashboard/batches/${batchId}`}
          className="border border-border hover:border-foreground/20 text-foreground px-4 py-2 rounded-lg text-sm font-medium transition"
        >
          Back to Batch
        </Link>
      </div>

      {/* Progress Bar */}
      <div className="glass-card rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between">
          {PROGRESS_STAGES.map((stage, i) => {
            const isDone = completedStages.has(stage.key);
            const isActive = currentStage === stage.key && !isDone;

            return (
              <div key={stage.key} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${
                      isDone
                        ? "bg-success text-white"
                        : isActive
                        ? "bg-primary text-white animate-pulse"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isDone ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      stage.icon
                    )}
                  </div>
                  <span
                    className={`text-xs mt-2 text-center hidden sm:block ${
                      isDone
                        ? "text-success font-medium"
                        : isActive
                        ? "text-primary font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    {stage.label}
                  </span>
                </div>
                {i < PROGRESS_STAGES.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 mx-2 mt-[-20px] sm:mt-[-32px] transition-all duration-700 ${
                      isDone ? "bg-success" : "bg-muted"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Activity Feed */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Activity
              </h2>
              {isRunning && (
                <span className="flex items-center gap-1.5 text-xs text-primary">
                  <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                  Processing
                </span>
              )}
            </div>
            <div
              ref={logRef}
              className="max-h-[500px] overflow-y-auto p-4 space-y-1"
            >
              {activityFeed.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {job.status === "pending"
                    ? "Waiting to start..."
                    : "Starting analysis..."}
                </p>
              )}
              {activityFeed.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-xl"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      item.status === "done"
                        ? "bg-success/10 text-success"
                        : item.status === "active"
                        ? "bg-primary/10 text-primary"
                        : "bg-danger/10 text-danger"
                    }`}
                  >
                    {item.status === "active" ? (
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    ) : (
                      item.icon
                    )}
                  </div>
                  <p
                    className={`text-sm font-medium flex-1 ${
                      item.status === "done"
                        ? "text-foreground"
                        : item.status === "active"
                        ? "text-primary"
                        : "text-danger"
                    }`}
                  >
                    {item.label}
                  </p>
                  {item.time && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {item.time}
                    </span>
                  )}
                </div>
              ))}
              {isRunning && activityFeed.length > 0 && activityFeed[activityFeed.length - 1]?.status !== "active" && (
                <div className="flex items-center gap-3 py-2.5 px-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                  <p className="text-sm text-primary font-medium">Analyzing data...</p>
                </div>
              )}
            </div>
          </div>

          {/* Summary */}
          {isComplete && decision && (
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-foreground mb-3">
                Summary
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {decision.reasoning}
              </p>
            </div>
          )}

          {/* Failed */}
          {isFailed && (
            <div className="glass-card rounded-2xl p-6 border border-danger/30">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-danger/10 flex items-center justify-center">
                  <svg className="w-4 h-4 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-sm font-semibold text-danger">
                  Lookup could not be completed
                </h2>
              </div>
              <p className="text-sm text-muted-foreground">
                We were unable to find enough information for a confident result. This can happen with uncommon names or limited online presence. You can try again or use a different LinkedIn URL.
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Results */}
        <div className="space-y-6">
          {decision && (
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Recommendation
              </h2>
              <div className="text-center mb-4">
                <div
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-lg font-bold ${
                    decision.recommendation === "HOME"
                      ? "bg-success/10 text-success"
                      : decision.recommendation === "OFFICE"
                      ? "bg-primary/10 text-primary"
                      : "bg-accent/10 text-accent"
                  }`}
                >
                  {decision.recommendation === "HOME" && (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                  )}
                  {decision.recommendation === "OFFICE" && (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  )}
                  {decision.recommendation === "BOTH" && (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  )}
                  Send to {decision.recommendation}
                </div>
              </div>
              <div className="flex justify-center mb-4">
                <ConfidenceRing confidence={decision.confidence} />
              </div>
              {decision.flags && decision.flags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  {decision.flags.map((flag, i) => (
                    <span
                      key={i}
                      className="text-xs bg-warning/15 text-warning px-2 py-1 rounded-full"
                    >
                      {flag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {decision?.home_address && (
            <AddressCard
              label="Home Address"
              address={decision.home_address}
              color="green"
            />
          )}
          {decision?.office_address && (
            <AddressCard
              label="Office Address"
              address={decision.office_address}
              color="blue"
            />
          )}

          {decision &&
            (decision.home_address || decision.office_address) && (
              <div className="glass-card rounded-2xl p-4">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Map
                </h2>
                <MapView
                  homeAddress={decision.home_address?.address}
                  officeAddress={decision.office_address?.address}
                />
              </div>
            )}

          {isRunning && !decision && (
            <div className="glass-card rounded-2xl p-6 text-center">
              <div className="w-12 h-12 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm font-medium text-foreground mb-1">
                Analyzing...
              </p>
              <p className="text-xs text-muted-foreground">
                This usually takes 1-3 minutes
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
    running: { label: "Processing", cls: "bg-primary/15 text-primary" },
    complete: { label: "Complete", cls: "bg-success/15 text-success" },
    failed: { label: "Failed", cls: "bg-danger/15 text-danger" },
  };

  const c = config[status] || config.pending;

  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${c.cls}`}>
      {c.label}
    </span>
  );
}

function ConfidenceRing({ confidence }: { confidence: number }) {
  const color =
    confidence >= 85
      ? "text-success"
      : confidence >= 75
      ? "text-primary"
      : "text-warning";

  return (
    <div className="relative w-20 h-20">
      <svg className="w-20 h-20 transform -rotate-90" viewBox="0 0 36 36">
        <path
          className="text-muted"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          className={color}
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray={`${confidence}, 100`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-lg font-bold ${color}`}>{confidence}%</span>
      </div>
    </div>
  );
}

function AddressCard({
  label,
  address,
  color,
}: {
  label: string;
  address: AddressInfo;
  color: "green" | "blue";
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(address.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const borderColor =
    color === "green" ? "border-success/50" : "border-primary/50";
  const labelColor =
    color === "green" ? "text-success" : "text-primary";
  const iconBg =
    color === "green" ? "bg-success/10" : "bg-primary/10";

  return (
    <div className={`glass-card rounded-2xl border ${borderColor} p-6`}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-6 h-6 rounded-full ${iconBg} flex items-center justify-center`}>
          {color === "green" ? (
            <svg className={`w-3 h-3 ${labelColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          ) : (
            <svg className={`w-3 h-3 ${labelColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          )}
        </div>
        <h3 className={`text-sm font-semibold ${labelColor}`}>
          {label}
        </h3>
      </div>
      <p className="text-foreground font-medium mb-2">{address.address}</p>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {address.confidence}% confidence
        </span>
        <button
          onClick={handleCopy}
          className="text-xs text-primary hover:text-primary-hover font-medium transition"
        >
          {copied ? "Copied!" : "Copy Address"}
        </button>
      </div>
    </div>
  );
}
