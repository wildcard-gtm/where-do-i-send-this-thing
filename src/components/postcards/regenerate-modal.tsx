"use client";

import { useState, useRef } from "react";

interface TeamPhoto {
  name?: string;
  photoUrl: string;
  title?: string;
  linkedinUrl?: string;
}

interface OpenRole {
  title: string;
  location?: string;
}

interface RegenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
  contactTitle: string | null;
  contactCompany?: string | null;
  contactLinkedinUrl?: string | null;
  currentPostcardId: string;
  currentTemplate: string;
  currentContactPhoto: string | null;
  currentCompanyLogo: string | null;
  currentTeamPhotos: TeamPhoto[] | null;
  currentOpenRoles: OpenRole[] | null;
  onRegenerated: (newPostcardId: string) => void;
}

export default function RegenerateModal({
  isOpen,
  onClose,
  contactId,
  contactName,
  contactTitle,
  contactCompany,
  contactLinkedinUrl,
  currentPostcardId,
  currentTemplate,
  currentContactPhoto,
  currentCompanyLogo,
  currentTeamPhotos,
  currentOpenRoles,
  onRegenerated,
}: RegenerateModalProps) {
  const [template, setTemplate] = useState(currentTemplate);
  const [contactPhoto, setContactPhoto] = useState(currentContactPhoto);
  const [companyLogo, setCompanyLogo] = useState(currentCompanyLogo);
  const [teamPhotos, setTeamPhotos] = useState<TeamPhoto[]>(currentTeamPhotos ?? []);
  const [openRoles, setOpenRoles] = useState<OpenRole[]>(currentOpenRoles ?? []);
  const [customPrompt, setCustomPrompt] = useState("");
  const [editingTeamIndex, setEditingTeamIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  const prospectFileRef = useRef<HTMLInputElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const teamFileRefs = useRef<(HTMLInputElement | null)[]>([]);

  if (!isOpen) return null;

  async function uploadImage(file: File): Promise<string | null> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/uploads/image", { method: "POST", body: formData });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url;
  }

  async function handleChangeProspectPhoto(file: File) {
    setUploadingField("prospect");
    const url = await uploadImage(file);
    if (url) setContactPhoto(url);
    setUploadingField(null);
  }

  async function handleChangeLogo(file: File) {
    setUploadingField("logo");
    const url = await uploadImage(file);
    if (url) setCompanyLogo(url);
    setUploadingField(null);
  }

  async function handleChangeTeamPhoto(index: number, file: File) {
    setUploadingField(`team-${index}`);
    const url = await uploadImage(file);
    if (url) {
      setTeamPhotos((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], photoUrl: url };
        return updated;
      });
    }
    setUploadingField(null);
  }

  function handleEditTeamName(index: number, name: string) {
    setTeamPhotos((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], name };
      return updated;
    });
  }

  function handleEditTeamTitle(index: number, title: string) {
    setTeamPhotos((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], title };
      return updated;
    });
  }

  function handleEditTeamLinkedin(index: number, linkedinUrl: string) {
    setTeamPhotos((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], linkedinUrl: linkedinUrl || undefined };
      return updated;
    });
  }

  async function handleRegenerate() {
    setSubmitting(true);
    try {
      // Create new postcard with overrides (old one becomes a revision)
      const res = await fetch("/api/postcards/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          template,
          customPrompt: customPrompt.trim() || null,
          contactPhoto,
          teamPhotos: teamPhotos.length > 0 ? teamPhotos : undefined,
          companyLogo,
          openRoles: openRoles.length > 0 ? openRoles : undefined,
          parentPostcardId: currentPostcardId,
        }),
      });
      const data = await res.json();
      if (data.postcardId) {
        // Fire and forget generation
        fetch(`/api/postcards/${data.postcardId}/run`, { method: "POST" }).catch(() => {});
        onRegenerated(data.postcardId);
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border/50">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Regenerate Postcard</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-sm text-muted-foreground">
                {contactName}
                {contactCompany && <span className="text-muted-foreground/60"> at {contactCompany}</span>}
              </p>
              {contactLinkedinUrl && (
                <a
                  href={contactLinkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground/50 hover:text-[#0A66C2] transition"
                  title="LinkedIn profile"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </a>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Prospect Photo + Company Logo row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Prospect Photo */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                Prospect Photo
              </label>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center overflow-hidden shrink-0 border border-border">
                  {contactPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={contactPhoto}
                      alt="Prospect"
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  )}
                </div>
                <div>
                  <input
                    ref={prospectFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleChangeProspectPhoto(f);
                    }}
                  />
                  <button
                    onClick={() => prospectFileRef.current?.click()}
                    disabled={uploadingField === "prospect"}
                    className="text-xs text-primary hover:text-primary-hover font-medium transition disabled:opacity-50"
                  >
                    {uploadingField === "prospect" ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        Uploading...
                      </span>
                    ) : (
                      "Change"
                    )}
                  </button>
                  {contactPhoto && (
                    <button
                      onClick={() => setContactPhoto(null)}
                      className="block text-xs text-muted-foreground hover:text-danger transition mt-0.5"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Company Logo */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                Company Logo
              </label>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden shrink-0 border border-border">
                  {companyLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={companyLogo}
                      alt="Logo"
                      className="w-14 h-14 object-contain"
                    />
                  ) : (
                    <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
                    </svg>
                  )}
                </div>
                <div>
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleChangeLogo(f);
                    }}
                  />
                  <button
                    onClick={() => logoFileRef.current?.click()}
                    disabled={uploadingField === "logo"}
                    className="text-xs text-primary hover:text-primary-hover font-medium transition disabled:opacity-50"
                  >
                    {uploadingField === "logo" ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        Uploading...
                      </span>
                    ) : (
                      "Change"
                    )}
                  </button>
                  {companyLogo && (
                    <button
                      onClick={() => setCompanyLogo(null)}
                      className="block text-xs text-muted-foreground hover:text-danger transition mt-0.5"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Team Members */}
          {teamPhotos.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                Team Members
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {teamPhotos.map((tp, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/20 group/team"
                  >
                    {/* Photo with upload overlay */}
                    <div className="relative w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                      {tp.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={tp.photoUrl}
                          alt={tp.name || "Team member"}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <span className="text-xs font-bold text-primary">
                          {(tp.name || "?")[0]?.toUpperCase()}
                        </span>
                      )}
                      <input
                        ref={(el) => { teamFileRefs.current[i] = el; }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleChangeTeamPhoto(i, f);
                        }}
                      />
                      <button
                        onClick={() => teamFileRefs.current[i]?.click()}
                        disabled={uploadingField === `team-${i}`}
                        className="absolute inset-0 bg-black/0 hover:bg-black/40 rounded-full flex items-center justify-center transition opacity-0 group-hover/team:opacity-100"
                        title="Change photo"
                      >
                        {uploadingField === `team-${i}` ? (
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                    </div>

                    {/* Info — display or edit mode */}
                    <div className="flex-1 min-w-0">
                      {editingTeamIndex === i ? (
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={tp.name || ""}
                            onChange={(e) => handleEditTeamName(i, e.target.value)}
                            placeholder="Name"
                            className="w-full text-xs font-medium text-foreground bg-background border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/40"
                          />
                          <input
                            type="text"
                            value={tp.title || ""}
                            onChange={(e) => handleEditTeamTitle(i, e.target.value)}
                            placeholder="Title"
                            className="w-full text-[11px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/40"
                          />
                          <input
                            type="text"
                            value={tp.linkedinUrl || ""}
                            onChange={(e) => handleEditTeamLinkedin(i, e.target.value)}
                            placeholder="LinkedIn URL"
                            className="w-full text-[11px] text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/40"
                          />
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-medium text-foreground truncate">{tp.name || "Unknown"}</p>
                            {tp.linkedinUrl && (
                              <a href={tp.linkedinUrl} target="_blank" rel="noopener noreferrer"
                                className="shrink-0 text-muted-foreground/50 hover:text-[#0A66C2] transition" title="LinkedIn profile">
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                              </a>
                            )}
                          </div>
                          {tp.title && <p className="text-[11px] text-muted-foreground truncate">{tp.title}</p>}
                        </div>
                      )}
                    </div>

                    {/* Actions: edit toggle + delete */}
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        onClick={() => setEditingTeamIndex(editingTeamIndex === i ? null : i)}
                        className={`p-1 rounded transition ${editingTeamIndex === i ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10 opacity-0 group-hover/team:opacity-100"}`}
                        title={editingTeamIndex === i ? "Done editing" : "Edit"}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          setTeamPhotos((prev) => prev.filter((_, j) => j !== i));
                          if (editingTeamIndex === i) setEditingTeamIndex(null);
                        }}
                        className="p-1 rounded text-muted-foreground hover:text-danger hover:bg-danger/10 transition opacity-0 group-hover/team:opacity-100"
                        title="Remove member"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contact Title */}
          {contactTitle && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Contact Title
              </label>
              <p className="text-sm text-foreground">{contactTitle}</p>
            </div>
          )}

          {/* Open Roles (Whiteboard) */}
          <div>
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                Whiteboard Roles
              </label>
              <div className="space-y-2">
                {openRoles.map((role, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={role.title}
                      onChange={(e) => {
                        setOpenRoles((prev) => {
                          const updated = [...prev];
                          updated[i] = { ...updated[i], title: e.target.value };
                          return updated;
                        });
                      }}
                      className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
                    />
                    <input
                      type="text"
                      value={role.location || ""}
                      onChange={(e) => {
                        setOpenRoles((prev) => {
                          const updated = [...prev];
                          updated[i] = { ...updated[i], location: e.target.value };
                          return updated;
                        });
                      }}
                      placeholder="Location"
                      className="w-32 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition placeholder:text-muted-foreground/50"
                    />
                    <button
                      onClick={() => setOpenRoles((prev) => prev.filter((_, j) => j !== i))}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-danger hover:bg-danger/10 transition"
                      title="Remove role"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setOpenRoles((prev) => [...prev, { title: "", location: "" }])}
                  className="text-xs text-primary hover:text-primary-hover font-medium transition"
                >
                  + Add Role
                </button>
              </div>
          </div>

          {/* Template Selection */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Template
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setTemplate("warroom")}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition border ${
                  template === "warroom"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
                }`}
              >
                War Room
              </button>
              <button
                onClick={() => setTemplate("zoom")}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition border ${
                  template === "zoom"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-primary/50"
                }`}
              >
                Zoom Room
              </button>
            </div>
          </div>

          {/* Custom Prompt */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">
              Additional Instructions for AI
            </label>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder='e.g. "Make the colors more vibrant" or "The prospect should be wearing a blue shirt"'
              rows={3}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition resize-none placeholder:text-muted-foreground/50"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border/50">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground transition"
          >
            Cancel
          </button>
          <button
            onClick={handleRegenerate}
            disabled={submitting || uploadingField !== null}
            className="inline-flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-medium transition text-sm"
          >
            {submitting ? (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : null}
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
