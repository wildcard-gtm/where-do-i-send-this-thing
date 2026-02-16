"use client";

interface UrlPasteInputProps {
  onUrlsParsed: (urls: string[]) => void;
}

export default function UrlPasteInput({ onUrlsParsed }: UrlPasteInputProps) {
  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    const urls = text
      .split(/[\n,]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    onUrlsParsed(urls);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        Paste LinkedIn URLs
      </label>
      <textarea
        onChange={handleChange}
        rows={8}
        className="w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-mono text-sm resize-y"
        placeholder={`https://www.linkedin.com/in/john-doe\nhttps://www.linkedin.com/in/jane-smith\nhttps://www.linkedin.com/in/bob-johnson`}
      />
      <p className="text-xs text-muted-foreground mt-1">
        One URL per line, or comma-separated.
      </p>
    </div>
  );
}
