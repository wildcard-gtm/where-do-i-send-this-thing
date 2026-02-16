"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";

// Dynamically import map to avoid SSR issues with Leaflet
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

export default function JobDetailPage() {
  const params = useParams();
  const batchId = params.id as string;
  const jobId = params.jobId as string;

  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Fetch job data
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

  // Connect to SSE stream if job is running
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
        fetchJob(); // Refresh to get final result
      }
    };

    source.onerror = () => {
      setStreaming(false);
      source.close();
    };

    return () => source.close();
  }, [job?.status, batchId, jobId, fetchJob]);

  // Auto-scroll activity log
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
  const thinkingEvents = events.filter((e) => e.type === "thinking");
  const fullReasoning = thinkingEvents
    .map((e) => e.data.text as string)
    .join("\n\n");

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-foreground">Job Detail</h1>
            <StatusBadge status={job.status} />
            {streaming && (
              <span className="flex items-center gap-1.5 text-xs text-primary">
                <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                Live
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {job.linkedinUrl}
          </p>
        </div>
        <Link
          href={`/dashboard/batches/${batchId}`}
          className="border border-border hover:border-border text-foreground px-4 py-2 rounded-lg text-sm font-medium transition"
        >
          Back to Batch
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Activity Log */}
        <div className="lg:col-span-2">
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border/50">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                Agent Activity
              </h2>
            </div>
            <div
              ref={logRef}
              className="max-h-[600px] overflow-y-auto p-4 space-y-3"
            >
              {events.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-8">
                  {job.status === "pending"
                    ? "Waiting to start..."
                    : "No events yet."}
                </p>
              )}
              {events.map((event, i) => (
                <EventCard key={i} event={event} />
              ))}
              {streaming && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  Processing...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Results */}
        <div className="space-y-6">
          {/* Decision Card */}
          {decision && (
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Decision
              </h2>
              <div className="text-center mb-4">
                <span
                  className={`text-3xl font-bold ${
                    decision.recommendation === "HOME"
                      ? "text-success"
                      : decision.recommendation === "OFFICE"
                      ? "text-primary"
                      : "text-accent"
                  }`}
                >
                  {decision.recommendation}
                </span>
              </div>
              <div className="flex justify-center mb-4">
                <ConfidenceRing confidence={decision.confidence} />
              </div>
              <p className="text-sm text-foreground text-center">
                {decision.reasoning}
              </p>
              {decision.flags && decision.flags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  {decision.flags.map((flag, i) => (
                    <span
                      key={i}
                      className="text-xs bg-warning/15 text-warning px-2 py-1 rounded"
                    >
                      {flag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Address Cards */}
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

          {/* Map */}
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

          {/* Full Reasoning */}
          {fullReasoning && (
            <div className="glass-card rounded-2xl p-6">
              <button
                onClick={() => setShowReasoning(!showReasoning)}
                className="flex items-center justify-between w-full text-sm font-semibold text-muted-foreground uppercase tracking-wider"
              >
                <span>Full Reasoning</span>
                <svg
                  className={`w-4 h-4 transition-transform ${
                    showReasoning ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {showReasoning && (
                <div className="mt-4 text-sm text-foreground whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {fullReasoning}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-border text-foreground",
    running: "bg-primary/15 text-primary",
    complete: "bg-success/15 text-success",
    failed: "bg-danger/15 text-danger",
  };

  return (
    <span
      className={`text-xs font-medium px-2.5 py-1 rounded-full ${
        colors[status] || colors.pending
      }`}
    >
      {status}
    </span>
  );
}

function ConfidenceRing({ confidence }: { confidence: number }) {
  const color =
    confidence >= 85
      ? "text-success"
      : confidence >= 75
      ? "text-warning"
      : "text-warning";

  return (
    <div className="relative w-20 h-20">
      <svg className="w-20 h-20 transform -rotate-90" viewBox="0 0 36 36">
        <path
          className="text-border"
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

  return (
    <div
      className={`glass-card rounded-2xl border ${borderColor} p-6`}
    >
      <h3 className={`text-sm font-semibold ${labelColor} mb-3`}>
        {label}
      </h3>
      <p className="text-foreground font-medium mb-2">{address.address}</p>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {address.confidence}% confidence
        </span>
        <button
          onClick={handleCopy}
          className="text-xs text-muted-foreground hover:text-foreground transition"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{address.reasoning}</p>
    </div>
  );
}

function EventCard({ event }: { event: AgentEvent }) {
  const [expanded, setExpanded] = useState(false);

  const typeConfig: Record<
    string,
    { label: string; color: string; icon: string }
  > = {
    agent_start: { label: "Agent Started", color: "text-muted-foreground", icon: ">" },
    iteration_start: {
      label: `Iteration ${event.iteration}`,
      color: "text-foreground",
      icon: "#",
    },
    thinking: { label: "Reasoning", color: "text-accent", icon: "~" },
    tool_call_start: {
      label: `Calling ${event.data.toolName}`,
      color: "text-primary",
      icon: ">",
    },
    tool_call_result: {
      label: `${event.data.toolName} ${event.data.success ? "OK" : "FAIL"}`,
      color: event.data.success ? "text-success" : "text-danger",
      icon: event.data.success ? "+" : "!",
    },
    decision_rejected: {
      label: `Decision Rejected (${event.data.confidence}%)`,
      color: "text-warning",
      icon: "!",
    },
    decision_accepted: {
      label: "Decision Accepted",
      color: "text-success",
      icon: "+",
    },
    error: { label: "Error", color: "text-danger", icon: "!" },
    complete: { label: "Complete", color: "text-success", icon: "+" },
  };

  const config = typeConfig[event.type] || {
    label: event.type,
    color: "text-muted-foreground",
    icon: "?",
  };

  // Skip iteration_start from display (it's just noise)
  if (event.type === "iteration_start") {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-xs text-muted-foreground font-mono">{config.icon}</span>
        <span className="text-xs text-muted-foreground font-medium">
          --- Iteration {event.iteration} ---
        </span>
      </div>
    );
  }

  const hasExpandableContent =
    event.type === "thinking" ||
    event.type === "tool_call_start" ||
    event.type === "tool_call_result";

  return (
    <div
      className={`glass-card rounded-xl p-3 ${
        hasExpandableContent ? "cursor-pointer" : ""
      }`}
      onClick={() => hasExpandableContent && setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <span className={`font-mono text-xs mt-0.5 ${config.color}`}>
          {config.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className={`text-sm font-medium ${config.color}`}>
              {config.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(event.timestamp).toLocaleTimeString()}
            </span>
          </div>

          {/* Summary line */}
          {event.type === "tool_call_result" && event.data.summary ? (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {String(event.data.summary)}
            </p>
          ) : null}

          {event.type === "thinking" && !expanded && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {String(event.data.text).slice(0, 120)}...
            </p>
          )}

          {/* Expanded content */}
          {expanded && event.type === "thinking" && (
            <p className="text-xs text-foreground mt-2 whitespace-pre-wrap">
              {String(event.data.text)}
            </p>
          )}

          {expanded && event.type === "tool_call_start" && (
            <pre className="text-xs text-muted-foreground mt-2 overflow-x-auto">
              {JSON.stringify(event.data.toolInput, null, 2)}
            </pre>
          )}

          {expanded && event.type === "tool_call_result" && event.data.data ? (
            <pre className="text-xs text-muted-foreground mt-2 overflow-x-auto max-h-48 overflow-y-auto">
              {JSON.stringify(event.data.data, null, 2)}
            </pre>
          ) : null}

          {hasExpandableContent && (
            <span className="text-xs text-muted-foreground mt-1 inline-block">
              {expanded ? "Click to collapse" : "Click to expand"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
