"use client";

import { useEffect, useState, useCallback } from "react";

interface SystemPrompt {
  id: string;
  key: string;
  label: string;
  content: string;
  updatedAt: string;
}

interface FeedbackItem {
  id: string;
  rating: string;
  comment: string | null;
  createdAt: string;
  contact: { name: string; linkedinUrl: string };
  user: { name: string; email: string };
}

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  createdAt: string;
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  _count: { contacts: number; batches: number };
}

interface ModelOption {
  provider: string;
  modelId: string;
  label: string;
}

interface ModelConfig {
  agent: { provider: string; modelId: string } | null;
  chat: { provider: string; modelId: string } | null;
  fallback: { provider: string; modelId: string } | null;
  image_gen: string | null;
  image_analysis: string | null;
}

interface BatchItem {
  id: string;
  name: string | null;
  status: string;
  createdAt: string;
  user: { name: string; email: string };
  totalJobs: number;
  completed: number;
  failed: number;
}

interface LogEntry {
  id: string;
  level: string;
  source: string;
  action: string;
  message: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

interface ServiceStatus {
  source: string;
  status: "ok" | "error" | "unknown";
  lastSuccess: string | null;
  lastError: { time: string; message: string } | null;
  recentLogs: LogEntry[];
}

interface AnalyticsSummary {
  callsToday: number;
  errorsToday: number;
  errorRate: number;
  totalTokensToday: number;
  inputTokensToday: number;
  outputTokensToday: number;
}

interface DailyRow {
  day: string;
  source: string;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
}

type Tab = "prompts" | "models" | "feedback" | "messages" | "users" | "batches" | "logs" | "analytics";
type ModelRoleKey = "agent" | "chat" | "fallback" | "image_gen" | "image_analysis";

const SERVICE_LABELS: Record<string, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  bedrock: "Bedrock",
  bright_data: "Bright Data",
  endato: "Endato",
  propmix: "PropMix",
  exa_ai: "Exa AI",
  supabase: "Supabase",
  system: "System",
};

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("prompts");
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [downloadingBatch, setDownloadingBatch] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [geminiImageModels, setGeminiImageModels] = useState<ModelOption[]>([]);
  const [geminiAnalysisModels, setGeminiAnalysisModels] = useState<ModelOption[]>([]);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({ agent: null, chat: null, fallback: null, image_gen: null, image_analysis: null });
  const [savingModel, setSavingModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState("");

  // New user form
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("user");
  const [addingUser, setAddingUser] = useState(false);

  // Status indicators
  const [serviceStatuses, setServiceStatuses] = useState<ServiceStatus[]>([]);
  const [statusModalService, setStatusModalService] = useState<ServiceStatus | null>(null);

  // Logs tab
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsCursor, setLogsCursor] = useState<string | null>(null);
  const [logsSearch, setLogsSearch] = useState("");
  const [logsLevel, setLogsLevel] = useState("");
  const [logsSource, setLogsSource] = useState("");
  const [logsFilterSources, setLogsFilterSources] = useState<string[]>([]);
  const [logsFilterLevels, setLogsFilterLevels] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Analytics tab
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | null>(null);
  const [analyticsDaily, setAnalyticsDaily] = useState<DailyRow[]>([]);

  useEffect(() => { document.title = "Admin | WDISTT"; }, []);

  // Load service statuses on mount + poll every 60s
  const loadStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/status");
      if (res.ok) {
        const data = await res.json();
        setServiceStatuses(data.services || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadStatuses();
    const interval = setInterval(loadStatuses, 60000);
    return () => clearInterval(interval);
  }, [loadStatuses]);

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      if (tab === "prompts") {
        const res = await fetch("/api/admin/prompts");
        if (res.status === 403) { setError("You don't have admin access."); return; }
        const data = await res.json();
        setPrompts(data.prompts || []);
      } else if (tab === "models") {
        const res = await fetch("/api/admin/models");
        if (res.status === 403) { setError("You don't have admin access."); return; }
        const data = await res.json();
        setAvailableModels(data.models || []);
        setGeminiImageModels(data.geminiImageModels || []);
        setGeminiAnalysisModels(data.geminiAnalysisModels || []);
        setModelConfig(data.current || { agent: null, chat: null, fallback: null, image_gen: null, image_analysis: null });
      } else if (tab === "feedback") {
        const res = await fetch("/api/admin/feedback");
        if (res.status === 403) { setError("You don't have admin access."); return; }
        const data = await res.json();
        setFeedback(data.feedback || []);
      } else if (tab === "messages") {
        const res = await fetch("/api/admin/messages");
        if (res.status === 403) { setError("You don't have admin access."); return; }
        const data = await res.json();
        setMessages(data.messages || []);
      } else if (tab === "users") {
        const res = await fetch("/api/admin/users");
        if (res.status === 403) { setError("You don't have admin access."); return; }
        const data = await res.json();
        setUsers(data.users || []);
      } else if (tab === "batches") {
        const res = await fetch("/api/admin/batches");
        if (res.status === 403) { setError("You don't have admin access."); return; }
        const data = await res.json();
        setBatches(data.batches || []);
      } else if (tab === "logs") {
        await loadLogs(true);
      } else if (tab === "analytics") {
        const res = await fetch("/api/admin/analytics");
        if (res.status === 403) { setError("You don't have admin access."); return; }
        const data = await res.json();
        setAnalyticsSummary(data.summary || null);
        setAnalyticsDaily(data.daily || []);
      }
    } catch {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs(reset = false) {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams();
      if (!reset && logsCursor) params.set("cursor", logsCursor);
      if (logsSearch) params.set("search", logsSearch);
      if (logsLevel) params.set("level", logsLevel);
      if (logsSource) params.set("source", logsSource);

      const res = await fetch(`/api/admin/logs?${params}`);
      if (res.status === 403) { setError("You don't have admin access."); return; }
      const data = await res.json();

      if (reset) {
        setLogs(data.logs || []);
      } else {
        setLogs((prev) => [...prev, ...(data.logs || [])]);
      }
      setLogsCursor(data.nextCursor || null);
      if (data.filters) {
        setLogsFilterSources(data.filters.sources || []);
        setLogsFilterLevels(data.filters.levels || []);
      }
    } catch {
      setError("Failed to load logs");
    } finally {
      setLogsLoading(false);
    }
  }

  function handleLogsFilter() {
    setLogsCursor(null);
    loadLogs(true);
  }

  function downloadLogs() {
    const lines = logs.map((l) => {
      const ts = new Date(l.createdAt).toISOString();
      return `[${ts}] [${l.level.toUpperCase()}] [${l.source}] [${l.action}] ${l.message}${l.meta ? ` | meta: ${JSON.stringify(l.meta)}` : ""}`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `app-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function startEditing(prompt: SystemPrompt) {
    setEditingId(prompt.id);
    setEditContent(prompt.content);
    setSaveSuccess("");
  }

  function cancelEditing() {
    setEditingId(null);
    setEditContent("");
  }

  async function savePrompt(id: string) {
    setSaving(true);
    setSaveSuccess("");
    try {
      const res = await fetch("/api/admin/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, content: editContent }),
      });
      if (res.ok) {
        const data = await res.json();
        setPrompts((prev) =>
          prev.map((p) => (p.id === id ? { ...p, content: data.prompt.content, updatedAt: data.prompt.updatedAt } : p))
        );
        setEditingId(null);
        setSaveSuccess(`Saved "${prompts.find((p) => p.id === id)?.label}"`);
        setTimeout(() => setSaveSuccess(""), 3000);
      }
    } catch {
      setError("Failed to save prompt");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddingUser(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newUserName,
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
        }),
      });
      if (res.ok) {
        setShowAddUser(false);
        setNewUserName("");
        setNewUserEmail("");
        setNewUserPassword("");
        setNewUserRole("user");
        loadData();
        setSaveSuccess("User created successfully");
        setTimeout(() => setSaveSuccess(""), 3000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create user");
      }
    } catch {
      setError("Failed to create user");
    } finally {
      setAddingUser(false);
    }
  }

  async function saveModelConfig(role: ModelRoleKey, provider: string | null, modelId: string) {
    setSavingModel(role);
    setError("");
    const isGemini = role === "image_gen" || role === "image_analysis";
    try {
      const res = await fetch("/api/admin/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, provider: isGemini ? "gemini" : provider, modelId }),
      });
      if (res.ok) {
        if (isGemini) {
          setModelConfig((prev) => ({ ...prev, [role]: modelId }));
        } else {
          setModelConfig((prev) => ({ ...prev, [role]: { provider, modelId } }));
        }
        const labels: Record<string, string> = {
          agent: "Agent", chat: "Chat", fallback: "Fallback",
          image_gen: "Image Generation", image_analysis: "Image Analysis",
        };
        setSaveSuccess(`${labels[role]} model updated`);
        setTimeout(() => setSaveSuccess(""), 3000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save model");
      }
    } catch {
      setError("Failed to save model");
    } finally {
      setSavingModel(null);
    }
  }

  async function downloadDebugCsv(batchId: string) {
    setDownloadingBatch(batchId);
    try {
      const res = await fetch(`/api/admin/batches/${batchId}/export-debug`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `batch-${batchId}-debug.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to download debug CSV");
    } finally {
      setDownloadingBatch(null);
    }
  }

  function getModelValue(config: { provider: string; modelId: string } | null): string {
    if (!config) return "";
    return `${config.provider}::${config.modelId}`;
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "prompts", label: "Prompts" },
    { key: "models", label: "Models" },
    { key: "logs", label: "Logs" },
    { key: "analytics", label: "Analytics" },
    { key: "feedback", label: "Feedback" },
    { key: "messages", label: "Messages" },
    { key: "users", label: "Users" },
    { key: "batches", label: "Batches" },
  ];

  const levelBadge = (level: string) => {
    switch (level) {
      case "info": return "bg-blue-500/10 text-blue-500";
      case "warn": return "bg-amber-500/10 text-amber-500";
      case "error": return "bg-danger/10 text-danger";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground mb-2">Admin</h1>
      <p className="text-muted-foreground text-sm mb-4">
        Manage system prompts, users, feedback, and contact messages.
      </p>

      {/* Service Status Indicators */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">API Status:</span>
        {serviceStatuses.length === 0 ? (
          <span className="text-xs text-muted-foreground">Loading...</span>
        ) : (
          serviceStatuses.map((s) => (
            <button
              key={s.source}
              onClick={() => setStatusModalService(s)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-full hover:bg-muted/50 transition text-xs"
              title={`${SERVICE_LABELS[s.source] || s.source}: ${s.status}`}
            >
              <div className={`w-2.5 h-2.5 rounded-full ${
                s.status === "ok" ? "bg-green-500" :
                s.status === "error" ? "bg-red-500" :
                "bg-gray-400"
              }`} />
              <span className="text-muted-foreground">{SERVICE_LABELS[s.source] || s.source}</span>
            </button>
          ))
        )}
      </div>

      {/* Status Detail Modal */}
      {statusModalService && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setStatusModalService(null)}>
          <div className="bg-card rounded-2xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${
                  statusModalService.status === "ok" ? "bg-green-500" :
                  statusModalService.status === "error" ? "bg-red-500" :
                  "bg-gray-400"
                }`} />
                <h3 className="text-lg font-semibold text-foreground">
                  {SERVICE_LABELS[statusModalService.source] || statusModalService.source}
                </h3>
              </div>
              <button onClick={() => setStatusModalService(null)} className="text-muted-foreground hover:text-foreground">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className={`font-medium ${
                  statusModalService.status === "ok" ? "text-green-500" :
                  statusModalService.status === "error" ? "text-red-500" :
                  "text-gray-400"
                }`}>{statusModalService.status.toUpperCase()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Last Success</span>
                <span className="text-foreground">
                  {statusModalService.lastSuccess
                    ? new Date(statusModalService.lastSuccess).toLocaleString()
                    : "Never"}
                </span>
              </div>
              {statusModalService.lastError && (
                <div className="text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Error</span>
                    <span className="text-danger">{new Date(statusModalService.lastError.time).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-danger/80 mt-1 bg-danger/5 rounded px-2 py-1">{statusModalService.lastError.message}</p>
                </div>
              )}
            </div>

            {statusModalService.recentLogs.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-foreground mb-2">Recent Logs</h4>
                <div className="space-y-1.5">
                  {statusModalService.recentLogs.map((log) => (
                    <div key={log.id} className="text-xs flex items-start gap-2 py-1">
                      <span className={`px-1.5 py-0.5 rounded font-medium shrink-0 ${levelBadge(log.level)}`}>
                        {log.level}
                      </span>
                      <span className="text-muted-foreground shrink-0">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                      <span className="text-foreground/80 truncate">{log.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-muted/50 p-1 rounded-lg w-fit flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === t.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger px-4 py-3 rounded-lg text-sm mb-6">
          {error}
        </div>
      )}

      {saveSuccess && (
        <div className="bg-success/10 border border-success/30 text-success px-4 py-3 rounded-lg text-sm mb-6">
          {saveSuccess}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Prompts Tab */}
          {tab === "prompts" && (
            <div className="space-y-8">
              {/* Group prompts by category */}
              {[
                { title: "Agent Prompts", filter: (p: SystemPrompt) => p.key.startsWith("agent_") && !p.key.startsWith("config_") },
                { title: "Tool Descriptions", filter: (p: SystemPrompt) => p.key.startsWith("tool_"), description: "These descriptions tell the AI when and how to use each tool." },
                { title: "Chat Prompts", filter: (p: SystemPrompt) => p.key.startsWith("chat_") && !p.key.startsWith("config_") },
              ].map((group) => {
                const groupPrompts = prompts.filter(group.filter);
                if (groupPrompts.length === 0) return null;
                return (
                  <div key={group.title}>
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">{group.title}</h3>
                      {group.description && <p className="text-xs text-muted-foreground mt-0.5">{group.description}</p>}
                    </div>
                    <div className="space-y-4">
                      {groupPrompts.map((prompt) => {
                        // Extract {{variables}} from content
                        const variables = Array.from(new Set(prompt.content.match(/\{\{(\w+)\}\}/g) || []));
                        return (
                          <div key={prompt.id} className="glass-card rounded-2xl p-6">
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <h3 className="text-base font-semibold text-foreground">{prompt.label}</h3>
                                <p className="text-xs text-muted-foreground">
                                  Key: {prompt.key} &middot; Updated:{" "}
                                  {new Date(prompt.updatedAt).toLocaleDateString("en-US", {
                                    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
                                  })}
                                </p>
                              </div>
                              {editingId !== prompt.id && (
                                <button
                                  onClick={() => startEditing(prompt)}
                                  className="text-sm font-medium text-primary hover:text-primary-hover transition flex items-center gap-1.5"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                  Edit
                                </button>
                              )}
                            </div>

                            {/* Variable hint */}
                            {variables.length > 0 && (
                              <div className="flex items-center gap-2 mb-3 flex-wrap">
                                <span className="text-xs text-muted-foreground">Variables:</span>
                                {variables.map((v) => (
                                  <span key={v} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-mono">
                                    {v}
                                  </span>
                                ))}
                              </div>
                            )}

                            {editingId === prompt.id ? (
                              <div>
                                {variables.length > 0 && (
                                  <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
                                    Keep the {`{{variable}}`} placeholders — they get replaced with real values at runtime.
                                  </p>
                                )}
                                <textarea
                                  value={editContent}
                                  onChange={(e) => setEditContent(e.target.value)}
                                  rows={20}
                                  className="w-full bg-background border border-border rounded-lg px-4 py-3 text-sm text-foreground font-mono focus-glow resize-y"
                                />
                                <div className="flex items-center justify-end gap-3 mt-3">
                                  <button onClick={cancelEditing} className="text-sm text-muted-foreground hover:text-foreground transition px-4 py-2">
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => savePrompt(prompt.id)}
                                    disabled={saving}
                                    className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition text-sm"
                                  >
                                    {saving ? "Saving..." : "Save Changes"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <pre className="bg-background/50 rounded-lg p-4 text-xs text-foreground/80 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                                {prompt.content}
                              </pre>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Models Tab */}
          {tab === "models" && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Choose which AI model powers the agent (address research) and chat (contact conversations).
              </p>

              {[
                { role: "agent" as ModelRoleKey, title: "Agent Model", description: "Used for address research and investigation. This model runs the multi-step agent loop with tool calls." },
                { role: "chat" as ModelRoleKey, title: "Chat Model", description: "Used for contact chat conversations. Responds to user questions about lookup results." },
                { role: "fallback" as ModelRoleKey, title: "Fallback Model", description: "Used when the agent model is rate-limited (e.g. Bedrock throttling). Should be an OpenAI model like GPT-5.2." },
              ].map(({ role, title, description }) => {
                const current = modelConfig[role];
                const currentValue = getModelValue(current as { provider: string; modelId: string } | null);
                const bedrockModels = availableModels.filter((m) => m.provider === "bedrock");
                const openaiModels = availableModels.filter((m) => m.provider === "openai");

                return (
                  <div key={role} className="glass-card rounded-2xl p-6">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">{title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                      </div>
                      {savingModel === role && (
                        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                    <select
                      value={currentValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) return;
                        const [provider, ...rest] = val.split("::");
                        const modelId = rest.join("::");
                        saveModelConfig(role, provider, modelId);
                      }}
                      disabled={savingModel === role}
                      className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm text-foreground focus-glow disabled:opacity-50"
                    >
                      <option value="">Select a model...</option>
                      <optgroup label="AWS Bedrock (Claude)">
                        {bedrockModels.map((m) => (
                          <option key={m.modelId} value={`bedrock::${m.modelId}`}>
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="OpenAI">
                        {openaiModels.map((m) => (
                          <option key={m.modelId} value={`openai::${m.modelId}`}>
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    {current && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Current: <span className="font-mono text-foreground/70">{(current as { provider: string; modelId: string }).provider}::{(current as { provider: string; modelId: string }).modelId}</span>
                      </p>
                    )}
                  </div>
                );
              })}

              {/* Gemini / Postcard Image Models */}
              <div className="pt-2">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">Postcard Image Generation (Gemini)</h3>
              </div>

              {[
                { role: "image_gen" as ModelRoleKey, title: "Image Generation Model", description: "Gemini model used to generate postcard scene images. Nano Banana 2 is the latest and fastest.", models: geminiImageModels, defaultModel: "gemini-3.1-flash-image-preview" },
                { role: "image_analysis" as ModelRoleKey, title: "Image Analysis Model", description: "Gemini model used to analyze and quality-check generated images. Flash is faster and cheaper.", models: geminiAnalysisModels, defaultModel: "gemini-2.5-flash" },
              ].map(({ role, title, description, models, defaultModel }) => {
                const currentValue = (modelConfig[role] as string | null) ?? defaultModel;
                return (
                  <div key={role} className="glass-card rounded-2xl p-6">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div>
                        <h3 className="text-base font-semibold text-foreground">{title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                      </div>
                      {savingModel === role && (
                        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      )}
                    </div>
                    <select
                      value={currentValue}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) return;
                        saveModelConfig(role, null, val);
                      }}
                      disabled={savingModel === role}
                      className="w-full px-4 py-3 bg-background border border-border rounded-lg text-sm text-foreground focus-glow disabled:opacity-50"
                    >
                      {models.map((m) => (
                        <option key={m.modelId} value={m.modelId}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground mt-2">
                      Current: <span className="font-mono text-foreground/70">{currentValue}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Logs Tab */}
          {tab === "logs" && (
            <div className="space-y-4">
              {/* Filter row */}
              <div className="flex gap-3 flex-wrap items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Search</label>
                  <input
                    type="text"
                    value={logsSearch}
                    onChange={(e) => setLogsSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLogsFilter()}
                    placeholder="Search messages..."
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus-glow"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Level</label>
                  <select
                    value={logsLevel}
                    onChange={(e) => setLogsLevel(e.target.value)}
                    className="px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus-glow"
                  >
                    <option value="">All levels</option>
                    {logsFilterLevels.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Source</label>
                  <select
                    value={logsSource}
                    onChange={(e) => setLogsSource(e.target.value)}
                    className="px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus-glow"
                  >
                    <option value="">All sources</option>
                    {logsFilterSources.map((s) => (
                      <option key={s} value={s}>{SERVICE_LABELS[s] || s}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleLogsFilter}
                  className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg font-medium transition text-sm"
                >
                  Filter
                </button>
                <button
                  onClick={downloadLogs}
                  disabled={logs.length === 0}
                  className="text-sm font-medium text-primary hover:text-primary-hover transition disabled:opacity-50 flex items-center gap-1.5 px-4 py-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download
                </button>
              </div>

              {/* Logs table */}
              <div className="glass-card rounded-2xl overflow-hidden">
                {logs.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No logs yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/30 text-xs text-muted-foreground uppercase tracking-wider">
                          <th className="text-left px-4 py-3 font-medium">Timestamp</th>
                          <th className="text-left px-4 py-3 font-medium">Level</th>
                          <th className="text-left px-4 py-3 font-medium">Source</th>
                          <th className="text-left px-4 py-3 font-medium">Action</th>
                          <th className="text-left px-4 py-3 font-medium">Message</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {logs.map((log) => (
                          <tr key={log.id} className="hover:bg-muted/20 transition">
                            <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap text-xs font-mono">
                              {new Date(log.createdAt).toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded ${levelBadge(log.level)}`}>
                                {log.level}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-foreground text-xs">
                              {SERVICE_LABELS[log.source] || log.source}
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground text-xs font-mono">
                              {log.action}
                            </td>
                            <td className="px-4 py-2.5 text-foreground/80 text-xs max-w-md truncate" title={log.message}>
                              {log.message}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Load More */}
              {logsCursor && (
                <div className="flex justify-center">
                  <button
                    onClick={() => loadLogs(false)}
                    disabled={logsLoading}
                    className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition text-sm"
                  >
                    {logsLoading ? "Loading..." : "Load More"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Analytics Tab */}
          {tab === "analytics" && (
            <div className="space-y-6">
              {/* Summary cards */}
              {analyticsSummary && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="glass-card rounded-2xl p-5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">API Calls Today</p>
                    <p className="text-3xl font-bold text-foreground mt-1">{analyticsSummary.callsToday.toLocaleString()}</p>
                    {analyticsSummary.errorsToday > 0 && (
                      <p className="text-xs text-danger mt-1">{analyticsSummary.errorsToday} errors</p>
                    )}
                  </div>
                  <div className="glass-card rounded-2xl p-5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Error Rate</p>
                    <p className={`text-3xl font-bold mt-1 ${analyticsSummary.errorRate > 20 ? "text-danger" : analyticsSummary.errorRate > 5 ? "text-amber-500" : "text-green-500"}`}>
                      {analyticsSummary.errorRate}%
                    </p>
                  </div>
                  <div className="glass-card rounded-2xl p-5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Tokens Used Today</p>
                    <p className="text-3xl font-bold text-foreground mt-1">
                      {analyticsSummary.totalTokensToday > 1000000
                        ? `${(analyticsSummary.totalTokensToday / 1000000).toFixed(1)}M`
                        : analyticsSummary.totalTokensToday > 1000
                        ? `${(analyticsSummary.totalTokensToday / 1000).toFixed(1)}K`
                        : analyticsSummary.totalTokensToday.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {analyticsSummary.inputTokensToday.toLocaleString()} in / {analyticsSummary.outputTokensToday.toLocaleString()} out
                    </p>
                  </div>
                </div>
              )}

              {/* Daily breakdown */}
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border/30">
                  <h3 className="text-sm font-semibold text-foreground">Daily Breakdown (Last 7 Days)</h3>
                </div>
                {analyticsDaily.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No data yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/30 text-xs text-muted-foreground uppercase tracking-wider">
                          <th className="text-left px-5 py-3 font-medium">Day</th>
                          <th className="text-left px-5 py-3 font-medium">Service</th>
                          <th className="text-right px-5 py-3 font-medium">Calls</th>
                          <th className="text-right px-5 py-3 font-medium">Errors</th>
                          <th className="text-right px-5 py-3 font-medium">Input Tokens</th>
                          <th className="text-right px-5 py-3 font-medium">Output Tokens</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {analyticsDaily.map((row, i) => (
                          <tr key={i} className="hover:bg-muted/20 transition">
                            <td className="px-5 py-2.5 text-foreground whitespace-nowrap">{row.day}</td>
                            <td className="px-5 py-2.5 text-foreground">{SERVICE_LABELS[row.source] || row.source}</td>
                            <td className="px-5 py-2.5 text-foreground text-right">{row.calls.toLocaleString()}</td>
                            <td className="px-5 py-2.5 text-right">
                              <span className={row.errors > 0 ? "text-danger" : "text-muted-foreground"}>{row.errors}</span>
                            </td>
                            <td className="px-5 py-2.5 text-muted-foreground text-right">{row.inputTokens.toLocaleString()}</td>
                            <td className="px-5 py-2.5 text-muted-foreground text-right">{row.outputTokens.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Feedback Tab */}
          {tab === "feedback" && (
            <div className="glass-card rounded-2xl overflow-hidden">
              {feedback.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No feedback yet.</div>
              ) : (
                <div className="divide-y divide-border/30">
                  {feedback.map((f) => (
                    <div key={f.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${f.rating === "like" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                            {f.rating === "like" ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" /></svg>
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{f.contact.name}</p>
                            <p className="text-xs text-muted-foreground">by {f.user.name} ({f.user.email})</p>
                            {f.comment && <p className="text-sm text-foreground/80 mt-2 bg-muted/50 rounded-lg px-3 py-2">{f.comment}</p>}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(f.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages Tab */}
          {tab === "messages" && (
            <div className="glass-card rounded-2xl overflow-hidden">
              {messages.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">No contact messages yet.</div>
              ) : (
                <div className="divide-y divide-border/30">
                  {messages.map((m) => (
                    <div key={m.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">{m.subject}</p>
                          <p className="text-xs text-muted-foreground">{m.name} &middot; {m.email}</p>
                          <p className="text-sm text-foreground/80 mt-2">{m.message}</p>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(m.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Batches Tab */}
          {tab === "batches" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{batches.length} batches across all users.</p>
              <div className="glass-card rounded-2xl overflow-hidden">
                {batches.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">No batches yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/30 text-xs text-muted-foreground uppercase tracking-wider">
                          <th className="text-left px-5 py-3 font-medium">Batch</th>
                          <th className="text-left px-5 py-3 font-medium">User</th>
                          <th className="text-left px-5 py-3 font-medium">Status</th>
                          <th className="text-left px-5 py-3 font-medium">Jobs</th>
                          <th className="text-left px-5 py-3 font-medium">Created</th>
                          <th className="text-right px-5 py-3 font-medium">Export</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {batches.map((b) => (
                          <tr key={b.id} className="hover:bg-muted/20 transition">
                            <td className="px-5 py-3">
                              <p className="font-medium text-foreground">{b.name || "Unnamed batch"}</p>
                              <p className="text-xs text-muted-foreground font-mono">{b.id}</p>
                            </td>
                            <td className="px-5 py-3">
                              <p className="text-foreground">{b.user.name}</p>
                              <p className="text-xs text-muted-foreground">{b.user.email}</p>
                            </td>
                            <td className="px-5 py-3">
                              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                                b.status === "complete" ? "bg-success/10 text-success" :
                                b.status === "processing" ? "bg-primary/10 text-primary" :
                                b.status === "failed" ? "bg-danger/10 text-danger" :
                                "bg-muted text-muted-foreground"
                              }`}>
                                {b.status}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-muted-foreground">
                              {b.completed}/{b.totalJobs}
                              {b.failed > 0 && <span className="text-danger ml-1">({b.failed} failed)</span>}
                            </td>
                            <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                              {new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <button
                                onClick={() => downloadDebugCsv(b.id)}
                                disabled={downloadingBatch === b.id}
                                className="text-xs font-medium text-primary hover:text-primary-hover transition disabled:opacity-50 flex items-center gap-1 ml-auto"
                              >
                                {downloadingBatch === b.id ? (
                                  <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                )}
                                Debug CSV
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Users Tab */}
          {tab === "users" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground">{users.length} Users</h3>
                <button
                  onClick={() => setShowAddUser(!showAddUser)}
                  className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg font-medium transition text-sm flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add User
                </button>
              </div>

              {showAddUser && (
                <form onSubmit={handleAddUser} className="glass-card rounded-2xl p-6 space-y-4">
                  <h4 className="text-sm font-semibold text-foreground">New User</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
                      <input
                        type="text"
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        required
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus-glow"
                        placeholder="Full name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
                      <input
                        type="email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        required
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus-glow"
                        placeholder="email@company.com"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Password</label>
                      <input
                        type="password"
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                        required
                        minLength={6}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus-glow"
                        placeholder="Min 6 characters"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Role</label>
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value)}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus-glow"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <button type="button" onClick={() => setShowAddUser(false)} className="text-sm text-muted-foreground hover:text-foreground transition px-4 py-2">
                      Cancel
                    </button>
                    <button type="submit" disabled={addingUser} className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition text-sm">
                      {addingUser ? "Creating..." : "Create User"}
                    </button>
                  </div>
                </form>
              )}

              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="divide-y divide-border/30">
                  {users.map((u) => (
                    <div key={u.id} className="px-5 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{u.name}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-muted-foreground">
                          {u._count.contacts} {u._count.contacts === 1 ? "contact" : "contacts"} &middot; {u._count.batches} {u._count.batches === 1 ? "scan" : "scans"}
                        </span>
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                          u.role === "admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                        }`}>
                          {u.role}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
