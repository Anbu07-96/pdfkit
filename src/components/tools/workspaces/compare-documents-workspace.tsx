"use client";

import { useState } from "react";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import { Button } from "@/components/ui/button";
import { executeToolJob } from "@/lib/processing/client";

export function CompareDocumentsWorkspace() {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultName, setResultName] = useState<string>("comparison-report.txt");
  const [error, setError] = useState<string | null>(null);

  const handleProcess = async () => {
    if (files.length !== 2) {
      setError("Please select exactly two PDF documents to compare.");
      return;
    }
    setLoading(true);
    setError(null);

    const form = new FormData();
    files.forEach((f) => form.append("files", f.file));

    try {
      const res = await executeToolJob("compare-documents", form);
      if (res.status === "succeeded" && res.artifact) {
        const url = URL.createObjectURL(res.artifact.blob);
        setResultUrl(url);
        setResultName(res.artifact.name);
      } else {
        setError(res.error?.message || "Failed to compare documents.");
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
        onFilesChange={setFiles}
      />

      {files.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-6 space-y-4">
          <p className="text-xs text-muted">
            Select 2 PDF documents (Document A and Document B). PDFKit will compare page text and structure.
          </p>

          {error && <p className="text-xs text-error">{error}</p>}

          <Button
            size="lg"
            onClick={handleProcess}
            disabled={loading || files.length !== 2}
            className="w-full"
          >
            {loading ? "Comparing Documents..." : "Compare 2 Documents"}
          </Button>

          {resultUrl && (
            <div className="p-4 rounded-xl border border-success/30 bg-success-subtle/20 text-center space-y-2">
              <p className="text-xs text-success font-semibold">Comparison complete!</p>
              <a
                href={resultUrl}
                download={resultName}
                className="inline-block px-4 py-2 text-xs font-semibold text-white bg-brand rounded-lg hover:bg-brand-hover"
              >
                Download Comparison Report
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
