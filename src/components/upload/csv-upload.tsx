"use client";

import { useCallback, useState } from "react";

interface CsvEntry {
  url: string;
  csvRowData?: Record<string, string>;
}

interface CsvUploadProps {
  onUrlsParsed: (entries: CsvEntry[]) => void;
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

        if (lines.length === 0) return;

        // Split a CSV line respecting quoted fields
        const splitRow = (line: string): string[] => {
          const cells: string[] = [];
          let current = "";
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
              inQuotes = !inQuotes;
            } else if (ch === "," && !inQuotes) {
              cells.push(current.trim().replace(/^"|"$/g, ""));
              current = "";
            } else {
              current += ch;
            }
          }
          cells.push(current.trim().replace(/^"|"$/g, ""));
          return cells;
        };

        // Check if first line looks like a header (any cell contains "linkedin")
        const firstLineCells = splitRow(lines[0]);
        const hasHeader = firstLineCells.some((c) =>
          c.toLowerCase().includes("linkedin")
        );

        if (hasHeader && lines.length > 1) {
          // Header-based parsing
          const headers = firstLineCells;
          const linkedinColIndex = headers.findIndex((h) =>
            h.toLowerCase().includes("linkedin")
          );

          const entries: CsvEntry[] = [];
          for (let i = 1; i < lines.length; i++) {
            const cells = splitRow(lines[i]);
            // Find LinkedIn URL in this row
            let url = "";
            if (linkedinColIndex >= 0 && cells[linkedinColIndex]) {
              const cell = cells[linkedinColIndex];
              if (cell.includes("linkedin.com/in/")) url = cell;
            }
            // Fallback: scan all cells for a LinkedIn URL
            if (!url) {
              for (const cell of cells) {
                if (cell.includes("linkedin.com/in/")) {
                  url = cell;
                  break;
                }
              }
            }
            if (!url) continue;

            // Build rowData from header→cell pairs, excluding the LinkedIn URL column and empty cells
            const rowData: Record<string, string> = {};
            for (let j = 0; j < headers.length; j++) {
              if (j === linkedinColIndex) continue;
              const header = headers[j]?.trim();
              const value = cells[j]?.trim();
              if (header && value) {
                rowData[header] = value;
              }
            }

            entries.push({
              url,
              csvRowData: Object.keys(rowData).length > 0 ? rowData : undefined,
            });
          }
          onUrlsParsed(entries);
        } else {
          // No header — fallback to URL-only extraction
          const entries: CsvEntry[] = [];
          for (const line of lines) {
            const cells = splitRow(line);
            for (const cell of cells) {
              if (cell.includes("linkedin.com/in/")) {
                entries.push({ url: cell });
              }
            }
          }
          onUrlsParsed(entries);
        }
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
