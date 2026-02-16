"use client";

import { useEffect, useState, useCallback } from "react";

interface FeedbackButtonsProps {
  contactId: string;
}

export default function FeedbackButtons({ contactId }: FeedbackButtonsProps) {
  const [rating, setRating] = useState<"like" | "dislike" | null>(null);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [comment, setComment] = useState("");
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    fetch(`/api/contacts/${contactId}/feedback`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.feedback) {
          setRating(data.feedback.rating as "like" | "dislike");
        }
        setFetched(true);
      })
      .catch(() => setFetched(true));
  }, [contactId]);

  const submitFeedback = useCallback(
    async (selectedRating: "like" | "dislike", feedbackComment?: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/contacts/${contactId}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating: selectedRating,
            comment: feedbackComment || undefined,
          }),
        });
        if (res.ok) {
          setRating(selectedRating);
        }
      } finally {
        setLoading(false);
      }
    },
    [contactId]
  );

  const handleLike = () => {
    if (loading) return;
    submitFeedback("like");
  };

  const handleDislike = () => {
    if (loading) return;
    setShowModal(true);
  };

  const handleDislikeSubmit = () => {
    submitFeedback("dislike", comment).then(() => {
      setShowModal(false);
      setComment("");
    });
  };

  const handleDislikeSkip = () => {
    submitFeedback("dislike").then(() => {
      setShowModal(false);
      setComment("");
    });
  };

  if (!fetched) return null;

  return (
    <>
      <div className="flex items-center gap-3">
        {/* Thumbs Up */}
        <button
          onClick={handleLike}
          disabled={loading}
          className={`group flex items-center justify-center w-10 h-10 rounded-xl border transition-all duration-200 ${
            rating === "like"
              ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
              : "bg-card border-border text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/10"
          } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          title="Helpful"
        >
          <svg
            className="w-5 h-5 transition-transform duration-200 group-hover:scale-110"
            viewBox="0 0 24 24"
            fill={rating === "like" ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" />
          </svg>
        </button>

        {/* Thumbs Down */}
        <button
          onClick={handleDislike}
          disabled={loading}
          className={`group flex items-center justify-center w-10 h-10 rounded-xl border transition-all duration-200 ${
            rating === "dislike"
              ? "bg-red-500/20 border-red-500/50 text-red-400"
              : "bg-card border-border text-muted-foreground hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/10"
          } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          title="Not helpful"
        >
          <svg
            className="w-5 h-5 transition-transform duration-200 group-hover:scale-110"
            viewBox="0 0 24 24"
            fill={rating === "dislike" ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 15V19a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10zM17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" />
          </svg>
        </button>
      </div>

      {/* Dislike Feedback Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setShowModal(false);
              setComment("");
            }}
          />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-md mx-4 glass-card rounded-2xl p-6 border border-border shadow-2xl">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Would you like to help us improve?
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Share what went wrong.
            </p>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Tell us what could be better..."
              rows={4}
              className="w-full rounded-xl bg-card border border-border px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 resize-none transition"
            />

            <div className="flex items-center justify-end gap-3 mt-4">
              <button
                onClick={handleDislikeSkip}
                disabled={loading}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200 disabled:opacity-50"
              >
                Skip
              </button>
              <button
                onClick={handleDislikeSubmit}
                disabled={loading}
                className="px-5 py-2 text-sm font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover transition-colors duration-200 disabled:opacity-50"
              >
                {loading ? "Submitting..." : "Submit Feedback"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
