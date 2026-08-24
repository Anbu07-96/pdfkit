"use client";

import { ImagesToPdfWorkspace } from "@/components/tools/workspaces/images-to-pdf-workspace";
import { runPngToPdf } from "@/lib/processing/client";

export interface PngToPdfWorkspaceProps {
  limits: { maxFiles: number; maxFileSize: number };
}

/**
 * PNG to PDF: the shared images→PDF workspace in PNG-only form. The upload
 * zone accepts PNGs only, and the conversion call hits the PNG tool, whose
 * server rejects any non-PNG payload by signature. Everything else —
 * ordering, processing, cancel, success, errors — is the proven shared flow.
 */
export function PngToPdfWorkspace({ limits }: PngToPdfWorkspaceProps) {
  return (
    <ImagesToPdfWorkspace
      limits={limits}
      variant={{
        extensions: [".png"],
        mimeTypes: ["image/png"],
        zoneLabel: "Upload PNG images",
        zoneHint: "Drag and drop PNG images here, or browse from your device.",
        emptyHint: "Upload one or more PNG images to get started.",
        fileWord: "image",
        run: runPngToPdf,
      }}
    />
  );
}
