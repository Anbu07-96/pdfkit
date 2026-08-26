"use client";

import { useState } from "react";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import { Button } from "@/components/ui/button";
import { executeToolJob } from "@/lib/processing/client";

export function PdfToExcelWorkspace() {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultName, setResultName] = useState<string>("document.xlsx");
  const [error, setError] = useState<string | null>(null);

  const file = files[0]?.file ?? null;

  const handleProcess = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    const form = new FormData();
    form.append("files", file);

    try {
      const res = await executeToolJob("pdf-to-excel", form);
      if (res.status === "succeeded" && res.artifact) {
        const url = URL.createObjectURL(res.artifact.blob);
        setResultUrl(url);
        setResultName(res.artifact.name);
      } else {
        setError(res.error?.message || "Failed to convert PDF to Excel.");
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
          <p className="text-xs text-muted">
            Extracts tabular structures from your PDF and exports them as an editable Excel spreadsheet (.xlsx).
          </p>

          {error && <p className="text-xs text-error">{error}</p>}

          <Button
            size="lg"
            onClick={handleProcess}
            disabled={loading}
            className="w-full"
          >
            {loading ? "Converting to Excel..." : "Convert to Excel"}
          </Button>

          {resultUrl && (
            <div className="p-4 rounded-xl border border-success/30 bg-success-subtle/20 text-center space-y-2">
              <p className="text-xs text-success font-semibold">Conversion complete!</p>
              <a
                href={resultUrl}
                download={resultName}
                className="inline-block px-4 py-2 text-xs font-semibold text-white bg-brand rounded-lg hover:bg-brand-hover"
              >
                Download Excel Spreadsheet (.xlsx)
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
