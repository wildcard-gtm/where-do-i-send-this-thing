"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ─── Types ─────────────────────────────────────────────────────

type CorrectionStage = "scan" | "enrich" | "postcard";

interface CorrectionEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  imageUrl?: string;
  toolCalls?: Array<{ tool: string; status: "running" | "done" }>;
  preview?: { markdown: string; changes: Record<string, unknown>; explanation: string };
  applied?: boolean;
}

// History entry for API (minimal shape)
interface HistoryEntry {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string }>;
}

interface CorrectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
  stage: CorrectionStage;
  availableStages?: CorrectionStage[];
  postcardId?: string;
  onApplied?: () => void;
}

// ─── Stage labels ──────────────────────────────────────────────

const stageLabels: Record<CorrectionStage, string> = {
  scan: "Scan Results",
  enrich: "Enrichment",
  postcard: "Postcard",
};

// ─── Component ─────────────────────────────────────────────────

export default function CorrectionModal({
  isOpen,
  onClose,
  contactId,
  contactName,
  stage: initialStage,
  availableStages,
  onApplied,
}: CorrectionModalProps) {
  const [stage, setStage] = useState<CorrectionStage>(initialStage);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-send initial message when modal opens
  const sendMessage = useCallback(
    async (text: string, imgData?: string, imgType?: string) => {
      if (sending) return;
      setSending(true);

      // Add user message to UI
      const userMsg: ChatMsg = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text,
        imageUrl: imgData ? `data:${imgType};base64,${imgData}` : undefined,
      };
      setMessages((prev) => [...prev, userMsg]);

      // Add placeholder assistant message for streaming
      const assistantId = `a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", toolCalls: [] },
      ]);

      try {
        const res = await fetch("/api/corrections/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactId,
            stage,
            message: text,
            history,
            imageData: imgData,
            imageMediaType: imgType,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `Error: ${errText}` }
                : m
            )
          );
          setSending(false);
          return;
        }

        // Read SSE stream
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let latestText = "";
        let currentToolCalls: Array<{ tool: string; status: "running" | "done" }> = [];
        let preview: ChatMsg["preview"] | undefined;
        let applied = false;

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const event: CorrectionEvent = JSON.parse(line.slice(6));

                switch (event.type) {
                  case "response_text": {
                    const text = event.data.text as string;
                    if (text && !(event.data.done && text === latestText)) {
                      latestText = text;
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === assistantId
                            ? { ...m, content: text, toolCalls: currentToolCalls.length ? [...currentToolCalls] : undefined, preview, applied }
                            : m
                        )
                      );
                    }
                    break;
                  }
                  case "tool_call": {
                    const toolName = event.data.tool as string;
                    currentToolCalls = [
                      ...currentToolCalls.map((tc) => ({ ...tc, status: "done" as const })),
                      { tool: toolName, status: "running" as const },
                    ];
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? { ...m, toolCalls: [...currentToolCalls] }
                          : m
                      )
                    );
                    break;
                  }
                  case "tool_result": {
                    currentToolCalls = currentToolCalls.map((tc) => ({
                      ...tc,
                      status: "done" as const,
                    }));
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? { ...m, toolCalls: [...currentToolCalls] }
                          : m
                      )
                    );
                    break;
                  }
                  case "preview": {
                    preview = {
                      markdown: event.data.markdown as string,
                      changes: event.data.changes as Record<string, unknown>,
                      explanation: event.data.explanation as string,
                    };
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId ? { ...m, preview } : m
                      )
                    );
                    break;
                  }
                  case "changes_applied": {
                    applied = true;
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId ? { ...m, applied: true } : m
                      )
                    );
                    onApplied?.();
                    break;
                  }
                  case "error": {
                    const errMsg = event.data.message as string;
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantId
                          ? { ...m, content: m.content || `Error: ${errMsg}` }
                          : m
                      )
                    );
                    break;
                  }
                }
              } catch {
                // Skip unparseable lines
              }
            }
          }
        }

        // Update history for future messages
        setHistory((prev) => [
          ...prev,
          { role: "user", content: text },
          { role: "assistant", content: latestText },
        ]);
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Connection error: ${(err as Error).message}` }
              : m
          )
        );
      } finally {
        setSending(false);
      }
    },
    [contactId, stage, history, sending, onApplied]
  );

  // Initialize on first open
  useEffect(() => {
    if (isOpen && !initialized) {
      setInitialized(true);
      sendMessage(
        `I'd like to review and correct the ${stageLabels[stage].toLowerCase()} for ${contactName}.`
      );
    }
  }, [isOpen, initialized, stage, contactName, sendMessage]);

  // Reset on stage change
  const handleStageChange = (newStage: CorrectionStage) => {
    if (newStage === stage) return;
    setStage(newStage);
    setMessages([]);
    setHistory([]);
    setInitialized(false);
  };

  // ─── Image handling ────────────────────────────────────────

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  function clearImage() {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ─── Send handler ──────────────────────────────────────────

  async function handleSend() {
    const text = input.trim();
    if ((!text && !imageFile) || sending) return;
    setInput("");

    let imgData: string | undefined;
    let imgType: string | undefined;

    if (imageFile) {
      const buffer = await imageFile.arrayBuffer();
      imgData = btoa(
        new Uint8Array(buffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ""
        )
      );
      imgType = imageFile.type;
      clearImage();
    }

    await sendMessage(text || "(image attached)", imgData, imgType);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ─── Approve handler ──────────────────────────────────────

  function handleApprove() {
    sendMessage("Yes, apply these changes.");
  }

  if (!isOpen) return null;

  const stages = availableStages ?? [initialStage];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col" style={{ height: "min(85vh, 720px)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Correct — {contactName}</h2>
              <p className="text-xs text-muted-foreground">AI-assisted correction</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stage selector */}
        {stages.length > 1 && (
          <div className="flex gap-1 px-5 py-2 border-b border-border/30">
            {stages.map((s) => (
              <button
                key={s}
                onClick={() => handleStageChange(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition capitalize ${
                  stage === s
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {stageLabels[s]}
              </button>
            ))}
          </div>
        )}

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-xl rounded-br-sm bg-primary text-white px-4 py-3 text-sm">
                    {msg.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={msg.imageUrl} alt="Attached" className="max-w-[200px] rounded-lg mb-2" />
                    )}
                    <span className="whitespace-pre-wrap">{msg.content !== "(image attached)" ? msg.content : !msg.imageUrl ? msg.content : ""}</span>
                  </div>
                </div>
              ) : (
                <div className="flex justify-start">
                  <div className="max-w-[85%] space-y-2">
                    {/* Tool call indicators */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {msg.toolCalls.map((tc, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                              tc.status === "running"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {tc.status === "running" && (
                              <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            )}
                            {tc.status === "done" && (
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                            {humanizeToolName(tc.tool)}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Text content */}
                    {msg.content && (
                      <div className="rounded-xl rounded-bl-sm bg-card px-4 py-3 text-sm shadow-sm">
                        <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1.5 prose-p:leading-relaxed prose-ul:my-1.5 prose-ul:pl-4 prose-ol:my-1.5 prose-ol:pl-4 prose-li:my-0.5 prose-li:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold prose-code:text-foreground prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}

                    {/* Preview block */}
                    {msg.preview && !msg.applied && (
                      <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
                        <div className="prose prose-sm max-w-none text-foreground mb-3">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.preview.markdown}
                          </ReactMarkdown>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleApprove}
                            disabled={sending}
                            className="px-4 py-1.5 rounded-lg bg-success/10 text-success text-xs font-medium hover:bg-success/20 transition disabled:opacity-50"
                          >
                            Approve Changes
                          </button>
                          <button
                            onClick={() => setInput("No, let me explain what I want instead...")}
                            disabled={sending}
                            className="px-4 py-1.5 rounded-lg bg-danger/10 text-danger text-xs font-medium hover:bg-danger/20 transition disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Applied confirmation */}
                    {msg.applied && (
                      <div className="rounded-xl border border-success/30 bg-success/5 px-4 py-2 flex items-center gap-2">
                        <svg className="w-4 h-4 text-success shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-xs font-medium text-success">Changes applied successfully</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {sending && messages[messages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="bg-card rounded-xl rounded-bl-sm px-4 py-3 shadow-sm">
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Image Preview */}
        {imagePreview && (
          <div className="px-5 pt-2">
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Preview" className="h-16 rounded-lg border border-border" />
              <button
                onClick={clearImage}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-danger text-white rounded-full flex items-center justify-center text-xs hover:bg-danger/80 transition"
              >
                &times;
              </button>
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-border/50 p-4">
          <div className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-muted-foreground hover:text-foreground transition p-2.5 rounded-lg hover:bg-muted/50 shrink-0"
              title="Attach image"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell the AI what to correct..."
              rows={1}
              className="flex-1 bg-card border border-border rounded-lg px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus-glow resize-none"
            />
            <button
              onClick={handleSend}
              disabled={(!input.trim() && !imageFile) || sending}
              className="bg-primary hover:bg-primary-hover disabled:opacity-50 text-white p-2.5 rounded-lg transition shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function humanizeToolName(name: string): string {
  const map: Record<string, string> = {
    search_person_address: "Searching addresses...",
    verify_property: "Verifying property...",
    calculate_distance: "Calculating distance...",
    search_web: "Searching web...",
    fetch_company_logo: "Fetching logo...",
    fetch_url: "Reading page...",
    scrape_linkedin_profile: "Checking LinkedIn...",
    view_current_record: "Viewing record...",
    preview_changes: "Preparing preview...",
    apply_changes: "Applying changes...",
  };
  return map[name] || name.replace(/_/g, " ") + "...";
}
