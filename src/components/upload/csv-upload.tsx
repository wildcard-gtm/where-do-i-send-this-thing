"use client";

import { useCallback, useState } from "react";

interface CsvUploadProps {
  onUrlsParsed: (urls: string[]) => void;
}

export default function CsvUpload({ onUrlsParsed }: CsvUploadProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const parseFile = useCallback(
    (file: File) => {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const lines = text.split(/[\n\r]+/).filter((l) => l.trim());

        const urls: string[] = [];
        for (const line of lines) {
          const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
          for (const cell of cells) {
            if (cell.includes("linkedin.com/in/")) {
              urls.push(cell);
            }
          }
        }
        onUrlsParsed(urls);
      };
      reader.readAsText(file);
    },
    [onUrlsParsed]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        Or upload a CSV
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition cursor-pointer ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-muted-foreground"
        }`}
        onClick={() => document.getElementById("csv-input")?.click()}
      >
        <input
          id="csv-input"
          type="file"
          accept=".csv,.txt"
          onChange={handleFileInput}
          className="hidden"
        />
        <svg
          className="w-8 h-8 mx-auto mb-3 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        {fileName ? (
          <p className="text-sm text-primary">{fileName}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Drop a CSV file here or click to browse
          </p>
        )}
      </div>
    </div>
  );
}
