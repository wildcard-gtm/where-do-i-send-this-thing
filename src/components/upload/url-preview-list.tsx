"use client";

interface UrlPreviewListProps {
  urls: string[];
  onRemove: (index: number) => void;
}

function isValidLinkedInUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?(\?.*)?$/i.test(url);
}

export default function UrlPreviewList({
  urls,
  onRemove,
}: UrlPreviewListProps) {
  if (urls.length === 0) return null;

  const validCount = urls.filter(isValidLinkedInUrl).length;
  const invalidCount = urls.length - validCount;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">
          {urls.length} URL{urls.length !== 1 ? "s" : ""} found
        </h3>
        {invalidCount > 0 && (
          <span className="text-xs text-warning">
            {invalidCount} invalid URL{invalidCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="glass-card rounded-lg max-h-64 overflow-y-auto divide-y divide-border/50">
        {urls.map((url, i) => {
          const valid = isValidLinkedInUrl(url);
          return (
            <div
              key={i}
              className="flex items-center justify-between px-4 py-2.5 group"
            >
              <span
                className={`text-sm font-mono truncate mr-4 ${
                  valid ? "text-foreground" : "text-warning"
                }`}
              >
                {!valid && (
                  <span className="mr-2" title="Invalid LinkedIn URL">
                    !
                  </span>
                )}
                {url}
              </span>
              <button
                onClick={() => onRemove(i)}
                className="text-muted-foreground hover:text-danger opacity-0 group-hover:opacity-100 transition shrink-0"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
