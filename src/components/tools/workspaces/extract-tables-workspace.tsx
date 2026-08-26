"use client";

import { useState } from "react";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import { Button } from "@/components/ui/button";
import { executeToolJob } from "@/lib/processing/client";

export function ExtractTablesWorkspace() {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultName, setResultName] = useState<string>("tables.xlsx");
  const [error, setError] = useState<string | null>(null);

  const file = files[0]?.file ?? null;

  const handleProcess = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    const form = new FormData();
    form.append("files", file);
    form.append("format", format);

    try {
      const res = await executeToolJob("extract-tables", form);
      if (res.status === "succeeded" && res.artifact) {
        const url = URL.createObjectURL(res.artifact.blob);
        setResultUrl(url);
        setResultName(res.artifact.name);
      } else {
        setError(res.error?.message || "Failed to extract tables.");
      }
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <UploadZone
        extensions={[".pdf"]}
        files={files}
        onFilesChange={(next) => {
          setFiles(next);
          setResultUrl(null);
        }}
      />

      {file && (
        <div className="rounded-2xl border border-border bg-surface p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-subtle block mb-1">
              Export Format
            </label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  value="xlsx"
                  checked={format === "xlsx"}
                  onChange={() => setFormat("xlsx")}
                />
                Excel (.xlsx)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  value="csv"
                  checked={format === "csv"}
                  onChange={() => setFormat("csv")}
                />
                CSV (.csv)
              </label>
            </div>
          </div>

          {error && <p className="text-xs text-error">{error}</p>}

          <Button
            size="lg"
            onClick={handleProcess}
            disabled={loading}
            className="w-full"
          >
            {loading ? "Extracting Tables..." : "Extract Tables"}
          </Button>

          {resultUrl && (
            <div className="p-4 rounded-xl border border-success/30 bg-success-subtle/20 text-center space-y-2">
              <p className="text-xs text-success font-medium">Extraction complete!</p>
              <a
                href={resultUrl}
                download={resultName}
                className="inline-block px-4 py-2 text-xs font-semibold text-white bg-brand rounded-lg hover:bg-brand-hover"
              >
                Download {resultName}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
