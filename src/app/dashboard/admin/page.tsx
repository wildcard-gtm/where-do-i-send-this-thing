"use client";

import { useEffect, useState } from "react";

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
}

type Tab = "prompts" | "models" | "feedback" | "messages" | "users";

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("prompts");
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({ agent: null, chat: null });
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

  useEffect(() => {
    loadData();
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
        setModelConfig(data.current || { agent: null, chat: null });
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
      }
    } catch {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
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

  async function saveModelConfig(role: "agent" | "chat", provider: string, modelId: string) {
    setSavingModel(role);
    setError("");
    try {
      const res = await fetch("/api/admin/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, provider, modelId }),
      });
      if (res.ok) {
        setModelConfig((prev) => ({ ...prev, [role]: { provider, modelId } }));
        setSaveSuccess(`${role === "agent" ? "Agent" : "Chat"} model updated`);
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

  function getModelValue(config: { provider: string; modelId: string } | null): string {
    if (!config) return "";
    return `${config.provider}::${config.modelId}`;
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "prompts", label: "Prompts" },
    { key: "models", label: "Models" },
    { key: "feedback", label: "Feedback" },
    { key: "messages", label: "Messages" },
    { key: "users", label: "Users" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground mb-2">Admin</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Manage system prompts, users, feedback, and contact messages.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-muted/50 p-1 rounded-lg w-fit">
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
                { role: "agent" as const, title: "Agent Model", description: "Used for address research and investigation. This model runs the multi-step agent loop with tool calls." },
                { role: "chat" as const, title: "Chat Model", description: "Used for contact chat conversations. Responds to user questions about lookup results." },
              ].map(({ role, title, description }) => {
                const current = modelConfig[role];
                const currentValue = getModelValue(current);
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
                        Current: <span className="font-mono text-foreground/70">{current.provider}::{current.modelId}</span>
                      </p>
                    )}
                  </div>
                );
              })}
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
                          {u._count.contacts} contacts &middot; {u._count.batches} scans
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
