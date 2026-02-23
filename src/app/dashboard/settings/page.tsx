"use client";

import { useEffect, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string; role: string };
}

interface PostcardTemplate {
  id: string;
  name: string;
  description: string | null;
  headline: string | null;
  bodyText: string | null;
  accentColor: string | null;
  backMessage: string | null;
  isDefault: boolean;
  createdAt: string;
}

interface Team {
  id: string;
  name: string;
  members: TeamMember[];
  templates: PostcardTemplate[];
}

interface AccountUser {
  id: string;
  name: string;
  email: string;
  role: string;
  teamId: string | null;
}

type Tab = "team" | "templates" | "account";

// ── Utility ───────────────────────────────────────────────────────────────────

function ColorSwatch({ hex }: { hex: string }) {
  return (
    <span
      className="inline-block w-4 h-4 rounded-full border border-border shrink-0"
      style={{ background: hex }}
    />
  );
}

// ── Template form modal ───────────────────────────────────────────────────────

function TemplateModal({
  template,
  onSave,
  onCancel,
}: {
  template: Partial<PostcardTemplate> | null;
  onSave: (data: Partial<PostcardTemplate>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [headline, setHeadline] = useState(template?.headline ?? "");
  const [bodyText, setBodyText] = useState(template?.bodyText ?? "");
  const [accentColor, setAccentColor] = useState(template?.accentColor ?? "");
  const [backMessage, setBackMessage] = useState(template?.backMessage ?? "");
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("Name required"); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave({ name, description, headline, bodyText, accentColor, backMessage, isDefault });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!template?.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl flex flex-col">
        <div className="flex items-center justify-between p-6 pb-4 border-b border-border/50">
          <h2 className="text-lg font-bold">{isEdit ? "Edit Template" : "New Template"}</h2>
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4 overflow-y-auto max-h-[70vh]">
          {error && <p className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Template name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="e.g. Tech Startup Outreach"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Short note about when to use this"
            />
          </div>

          <div className="border-t border-border/50 pt-4">
            <p className="text-xs text-muted-foreground mb-3">
              Leave any field blank to have it AI-generated per postcard from enrichment data.
            </p>

            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Fixed headline</label>
                <input
                  value={headline}
                  onChange={e => setHeadline(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="Leave blank for AI-generated"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Fixed description body</label>
                <textarea
                  value={bodyText}
                  onChange={e => setBodyText(e.target.value)}
                  rows={3}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="Leave blank for AI-generated"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Accent colour (hex)</label>
                <div className="flex items-center gap-2">
                  <input
                    value={accentColor}
                    onChange={e => setAccentColor(e.target.value)}
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                    placeholder="#2563EB — leave blank to extract from logo"
                  />
                  {accentColor && /^#[0-9a-fA-F]{6}$/.test(accentColor) && (
                    <ColorSwatch hex={accentColor} />
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-border/50 pt-4">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Default back-of-card message</label>
            <textarea
              value={backMessage}
              onChange={e => setBackMessage(e.target.value)}
              rows={5}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Hi [First Name], …"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} className="w-4 h-4 accent-primary" />
            <span className="text-sm text-foreground">Set as default template</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 pt-2 border-t border-border/50">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-muted-foreground border border-border hover:border-muted-foreground transition">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-5 py-2 rounded-lg font-medium text-sm transition"
          >
            {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
            {isEdit ? "Save Changes" : "Create Template"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main settings page ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("team");
  const [team, setTeam] = useState<Team | null>(null);
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Team state
  const [teamName, setTeamName] = useState("");
  const [editingTeamName, setEditingTeamName] = useState(false);
  const [savingTeamName, setSavingTeamName] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Templates state
  const [templateModal, setTemplateModal] = useState<{ open: boolean; template: Partial<PostcardTemplate> | null }>({ open: false, template: null });
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  // Account state
  const [accountName, setAccountName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountResult, setAccountResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Invite form state (expanded when account needs to be created)
  const [inviteNeedsPassword, setInviteNeedsPassword] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteConfirmPassword, setInviteConfirmPassword] = useState("");

  const fetchData = useCallback(async () => {
    const [teamRes, accountRes] = await Promise.all([
      fetch("/api/team"),
      fetch("/api/account"),
    ]);
    if (teamRes.ok) {
      const { team: t } = await teamRes.json();
      setTeam(t);
      if (t) setTeamName(t.name);
    }
    if (accountRes.ok) {
      const { user } = await accountRes.json();
      setAccount(user);
      setAccountName(user.name);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Team handlers ──────────────────────────────────────────────────────────

  const handleSaveTeamName = async () => {
    if (!teamName.trim()) return;
    setSavingTeamName(true);
    const res = await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: teamName }) });
    if (res.ok) { setEditingTeamName(false); await fetchData(); }
    setSavingTeamName(false);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    // If expanded form: validate passwords match
    if (inviteNeedsPassword) {
      if (!invitePassword.trim()) { setInviteResult({ ok: false, message: "Password required" }); return; }
      if (invitePassword !== inviteConfirmPassword) { setInviteResult({ ok: false, message: "Passwords do not match" }); return; }
    }

    setInviting(true);
    setInviteResult(null);
    const body: Record<string, string> = { email: inviteEmail };
    if (inviteNeedsPassword) {
      body.password = invitePassword;
      if (inviteName.trim()) body.name = inviteName;
    }
    const res = await fetch("/api/team/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();

    if (!res.ok && data.needsPassword) {
      // User doesn't exist — expand form to collect password
      setInviteNeedsPassword(true);
      setInviteResult({ ok: false, message: "No account found. Enter a name and password to create one." });
      setInviting(false);
      return;
    }

    setInviteResult({ ok: res.ok, message: data.message || data.error || "Unknown error" });
    if (res.ok) {
      setInviteEmail("");
      setInviteNeedsPassword(false);
      setInviteName("");
      setInvitePassword("");
      setInviteConfirmPassword("");
      await fetchData();
    }
    setInviting(false);
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm("Remove this member from the team?")) return;
    await fetch(`/api/team/members/${userId}`, { method: "DELETE" });
    await fetchData();
  };

  // ── Template handlers ──────────────────────────────────────────────────────

  const handleSaveTemplate = async (data: Partial<PostcardTemplate>) => {
    const isEdit = !!templateModal.template?.id;
    const url = isEdit ? `/api/team/templates/${templateModal.template!.id}` : "/api/team/templates";
    const res = await fetch(url, {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Failed to save template");
    setTemplateModal({ open: false, template: null });
    await fetchData();
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    setDeletingTemplateId(id);
    await fetch(`/api/team/templates/${id}`, { method: "DELETE" });
    setDeletingTemplateId(null);
    await fetchData();
  };

  const handleSetDefaultTemplate = async (id: string) => {
    await fetch(`/api/team/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    await fetchData();
  };

  // ── Account handler ────────────────────────────────────────────────────────

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountResult(null);
    if (newPassword && newPassword !== confirmPassword) {
      setAccountResult({ ok: false, message: "New passwords do not match" });
      return;
    }
    setSavingAccount(true);
    const body: Record<string, string> = {};
    if (accountName.trim() && accountName !== account?.name) body.name = accountName.trim();
    if (newPassword) { body.currentPassword = currentPassword; body.newPassword = newPassword; }
    if (Object.keys(body).length === 0) { setSavingAccount(false); setAccountResult({ ok: false, message: "Nothing changed" }); return; }
    const res = await fetch("/api/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    setAccountResult({ ok: res.ok, message: res.ok ? "Changes saved" : (data.error || "Failed") });
    if (res.ok) { setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); await fetchData(); }
    setSavingAccount(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: "team",
      label: "Team",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      id: "templates",
      label: "Templates",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm12 0a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      ),
    },
    {
      id: "account",
      label: "Account",
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
  ];

  return (
    <div>
      {templateModal.open && (
        <TemplateModal
          template={templateModal.template}
          onSave={handleSaveTemplate}
          onCancel={() => setTemplateModal({ open: false, template: null })}
        />
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your team, postcard templates, and account.</p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Team tab ── */}
      {activeTab === "team" && (
        <div className="flex flex-col gap-6 max-w-2xl">
          {/* Team name */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground">Team</h2>
              {team && !editingTeamName && (
                <button onClick={() => setEditingTeamName(true)} className="text-xs text-primary hover:text-primary-hover font-medium transition">
                  Edit name
                </button>
              )}
            </div>

            {team ? (
              editingTeamName ? (
                <div className="flex items-center gap-2">
                  <input
                    value={teamName}
                    onChange={e => setTeamName(e.target.value)}
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    onClick={handleSaveTeamName}
                    disabled={savingTeamName}
                    className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    Save
                  </button>
                  <button onClick={() => { setEditingTeamName(false); setTeamName(team.name); }} className="text-sm text-muted-foreground hover:text-foreground px-2 transition">
                    Cancel
                  </button>
                </div>
              ) : (
                <p className="text-lg font-semibold text-foreground">{team.name}</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">No team yet.</p>
            )}
          </div>

          {/* Members */}
          {team && (
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-base font-semibold text-foreground mb-4">Members ({team.members.length})</h2>
              <div className="flex flex-col divide-y divide-border/30">
                {team.members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                        {m.user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{m.user.name}</p>
                        <p className="text-xs text-muted-foreground">{m.user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        m.role === "owner" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                      }`}>
                        {m.role}
                      </span>
                      {m.user.id !== account?.id && (
                        <button
                          onClick={() => handleRemoveMember(m.user.id)}
                          className="text-xs text-danger hover:text-danger/80 transition"
                          title="Remove from team"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Invite form */}
              <div className="mt-5 border-t border-border/50 pt-5">
                <h3 className="text-sm font-semibold text-foreground mb-3">Add member</h3>
                <form onSubmit={handleInvite} className="flex flex-col gap-3">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => { setInviteEmail(e.target.value); setInviteNeedsPassword(false); setInviteResult(null); setInvitePassword(""); setInviteConfirmPassword(""); setInviteName(""); }}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    placeholder="Email address"
                    required
                  />

                  {inviteNeedsPassword && (
                    <>
                      <input
                        type="text"
                        value={inviteName}
                        onChange={e => setInviteName(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="Display name (optional)"
                      />
                      <input
                        type="password"
                        value={invitePassword}
                        onChange={e => setInvitePassword(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="Password for new account"
                        required
                      />
                      <div>
                        <input
                          type="password"
                          value={inviteConfirmPassword}
                          onChange={e => setInviteConfirmPassword(e.target.value)}
                          className={`w-full bg-background border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 transition ${
                            inviteConfirmPassword && inviteConfirmPassword !== invitePassword
                              ? "border-danger focus:ring-danger/40"
                              : "border-border focus:ring-primary/40"
                          }`}
                          placeholder="Confirm password"
                          required
                        />
                        {inviteConfirmPassword && inviteConfirmPassword !== invitePassword && (
                          <p className="mt-1 text-xs text-danger">Passwords do not match</p>
                        )}
                      </div>
                    </>
                  )}

                  {inviteResult && (
                    <p className={`text-xs ${inviteResult.ok ? "text-success" : "text-danger"}`}>
                      {inviteResult.message}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={inviting || !inviteEmail.trim()}
                    className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    {inviting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                    {inviteNeedsPassword ? "Create Account & Add" : "Add Member"}
                  </button>
                </form>
                <p className="mt-2 text-xs text-muted-foreground">
                  If they already have an account they&apos;ll be added directly. Otherwise you&apos;ll be prompted to set a password for them.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Templates tab ── */}
      {activeTab === "templates" && (
        <div className="flex flex-col gap-4 max-w-3xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Postcard Templates</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Reusable copy and styling presets. Leave fields blank to use AI generation per postcard.
              </p>
            </div>
            {team && (
              <button
                onClick={() => setTemplateModal({ open: true, template: null })}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Template
              </button>
            )}
          </div>

          {!team && (
            <div className="glass-card rounded-2xl p-8 text-center">
              <p className="text-muted-foreground text-sm">Templates are tied to your team.</p>
            </div>
          )}

          {team && team.templates.length === 0 && (
            <div className="glass-card rounded-2xl p-8 text-center">
              <p className="text-muted-foreground text-sm">No templates yet. Create one to speed up postcard generation.</p>
            </div>
          )}

          {team && team.templates.map((tpl) => (
            <div key={tpl.id} className="glass-card rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-semibold text-foreground">{tpl.name}</span>
                    {tpl.isDefault && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">Default</span>
                    )}
                  </div>
                  {tpl.description && (
                    <p className="text-xs text-muted-foreground mb-2">{tpl.description}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {tpl.headline ? (
                      <span>Headline: <span className="text-foreground">{tpl.headline.slice(0, 40)}{tpl.headline.length > 40 ? "…" : ""}</span></span>
                    ) : (
                      <span className="italic">Headline: AI-generated</span>
                    )}
                    {tpl.accentColor ? (
                      <span className="flex items-center gap-1">Colour: <ColorSwatch hex={tpl.accentColor} /> <span className="text-foreground font-mono">{tpl.accentColor}</span></span>
                    ) : (
                      <span className="italic">Colour: extracted from logo</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!tpl.isDefault && (
                    <button onClick={() => handleSetDefaultTemplate(tpl.id)} className="text-xs text-muted-foreground hover:text-foreground transition px-2 py-1 rounded border border-border hover:border-muted-foreground">
                      Set default
                    </button>
                  )}
                  <button
                    onClick={() => setTemplateModal({ open: true, template: tpl })}
                    className="text-xs text-primary hover:text-primary-hover transition"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteTemplate(tpl.id)}
                    disabled={deletingTemplateId === tpl.id}
                    className="text-xs text-danger hover:text-danger/80 transition disabled:opacity-50"
                  >
                    {deletingTemplateId === tpl.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Account tab ── */}
      {activeTab === "account" && (
        <form onSubmit={handleSaveAccount} className="flex flex-col gap-6 max-w-md">
          <div className="glass-card rounded-2xl p-6 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-foreground">Profile</h2>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Display name</label>
              <input
                value={accountName}
                onChange={e => setAccountName(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
              <input
                value={account?.email ?? ""}
                disabled
                className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
              />
            </div>
          </div>

          <div className="glass-card rounded-2xl p-6 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-foreground">Change Password</h2>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="Required to change password"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder="Leave blank to keep current"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className={`w-full bg-background border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 transition ${
                  confirmPassword && confirmPassword !== newPassword
                    ? "border-danger focus:ring-danger/40"
                    : "border-border focus:ring-primary/40"
                }`}
                placeholder="Re-enter new password"
              />
              {confirmPassword && confirmPassword !== newPassword && (
                <p className="mt-1 text-xs text-danger">Passwords do not match</p>
              )}
            </div>
          </div>

          {accountResult && (
            <p className={`text-sm ${accountResult.ok ? "text-success" : "text-danger"}`}>
              {accountResult.message}
            </p>
          )}

          <button
            type="submit"
            disabled={savingAccount}
            className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition"
          >
            {savingAccount ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
            Save Changes
          </button>
        </form>
      )}
    </div>
  );
}
