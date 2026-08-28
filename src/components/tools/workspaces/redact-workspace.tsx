"use client";

import { useState } from "react";
import { UploadZone, type SelectedFile } from "@/components/upload/upload-zone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { executeToolJob } from "@/lib/processing/client";

export function RedactWorkspace() {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [pages, setPages] = useState("all");
  const [fillColor, setFillColor] = useState("#000000");
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultName, setResultName] = useState<string>("redacted.pdf");
  const [error, setError] = useState<string | null>(null);

  const file = files[0]?.file ?? null;

  const handleProcess = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    const form = new FormData();
    form.append("files", file);
    form.append("pages", pages);
    form.append("fillColor", fillColor);

    try {
      const res = await executeToolJob("redact-information", form);
      if (res.status === "succeeded" && res.artifact) {
        const url = URL.createObjectURL(res.artifact.blob);
        setResultUrl(url);
        setResultName(res.artifact.name);
      } else {
        setError(res.error?.message || "Failed to redact PDF.");
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
          <Input
            label="Page Range"
            placeholder="e.g. 1-3, 5 or all"
            value={pages}
            onChange={(e) => setPages(e.target.value)}
          />

          <div>
            <label className="text-xs font-medium text-subtle block mb-1">
              Redaction Fill Color
            </label>
            <input
              type="color"
              value={fillColor}
              onChange={(e) => setFillColor(e.target.value)}
              className="h-10 w-20 rounded border border-border cursor-pointer bg-surface p-1"
            />
          </div>

          <div className="p-3 rounded-lg bg-warning-subtle/30 text-xs text-muted">
            <strong>Privacy Note:</strong> Redaction draws visual blackout overlays over selected page areas.
          </div>

          {error && <p className="text-xs text-error">{error}</p>}

          <Button
            size="lg"
            onClick={handleProcess}
            disabled={loading}
            className="w-full"
          >
            {loading ? "Redacting PDF..." : "Apply Redaction"}
          </Button>

          {resultUrl && (
            <div className="p-4 rounded-xl border border-success/30 bg-success-subtle/20 text-center space-y-2">
              <p className="text-xs text-success font-medium">Redaction complete!</p>
              <a
                href={resultUrl}
                download={resultName}
                className="inline-block px-4 py-2 text-xs font-semibold text-white bg-brand rounded-lg hover:bg-brand-hover"
              >
                Download Redacted PDF
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
