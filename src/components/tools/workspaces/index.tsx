import { CompressPdfWorkspace } from "@/components/tools/workspaces/compress-pdf-workspace";
import { ImagesToPdfWorkspace } from "@/components/tools/workspaces/images-to-pdf-workspace";
import { PdfToImageWorkspace } from "@/components/tools/workspaces/pdf-to-image-workspace";
import { DeletePdfPagesWorkspace } from "@/components/tools/workspaces/delete-pdf-pages-workspace";
import { ExtractPdfPagesWorkspace } from "@/components/tools/workspaces/extract-pdf-pages-workspace";
import { MergePdfWorkspace } from "@/components/tools/workspaces/merge-pdf-workspace";
import { ReorderPdfPagesWorkspace } from "@/components/tools/workspaces/reorder-pdf-pages-workspace";
import { RotatePdfWorkspace } from "@/components/tools/workspaces/rotate-pdf-workspace";
import { SplitPdfWorkspace } from "@/components/tools/workspaces/split-pdf-workspace";
import { getProcessingLimits } from "@/lib/processing/limits";
import { getThumbnailLimits } from "@/lib/thumbnails/limits";
import { getInputRules } from "@/lib/processing/rules";

/**
 * Maps a tool id to its interactive workspace.
 *
 * A tool only appears here once its processing genuinely exists — the same rule
 * the catalog status and the processor registry follow. Tools without an entry
 * fall back to the "coming soon" tool page.
 *
 * Note: limits are read on the server. Tool pages are statically generated, so
 * the numbers shown in the interface come from the build-time configuration
 * while the API always enforces the current runtime configuration.
 */
export function getToolWorkspace(toolId: string): React.ReactNode | null {
  switch (toolId) {
    case "images-to-pdf": {
      const limits = getProcessingLimits();
      return (
        <ImagesToPdfWorkspace
          limits={{
            maxFiles: limits.maxFiles,
            maxFileSize: limits.maxFileSize,
          }}
        />
      );
    }
    case "pdf-to-jpg": {
      const limits = getProcessingLimits();
      return (
        <PdfToImageWorkspace
          format="jpg"
          limits={{
            maxFileSize: limits.maxFileSize,
            maxPages: limits.maxConversionPages,
          }}
        />
      );
    }
    case "pdf-to-png": {
      const limits = getProcessingLimits();
      return (
        <PdfToImageWorkspace
          format="png"
          limits={{
            maxFileSize: limits.maxFileSize,
            maxPages: limits.maxConversionPages,
          }}
        />
      );
    }
    case "compress-pdf": {
      const limits = getProcessingLimits();
      return (
        <CompressPdfWorkspace
          limits={{
            maxFileSize: limits.maxFileSize,
            maxRasterPages: limits.maxCompressRasterPages,
          }}
        />
      );
    }
    case "merge-pdf": {
      const limits = getProcessingLimits();
      const rules = getInputRules("merge-pdf");
      return (
        <MergePdfWorkspace
          limits={{
            minFiles: rules?.minFiles ?? 2,
            maxFiles: limits.maxFiles,
            maxFileSize: limits.maxFileSize,
            maxTotalSize: limits.maxTotalSize,
          }}
        />
      );
    }
    case "split-pdf": {
      const limits = getProcessingLimits();
      const thumbnails = getThumbnailLimits();
      return (
        <SplitPdfWorkspace
          limits={{
            maxFileSize: limits.maxFileSize,
            maxOutputs: limits.maxOutputs,
            thumbnailMaxPages: thumbnails.maxPages,
          }}
        />
      );
    }
    case "extract-pdf-pages": {
      const limits = getProcessingLimits();
      const thumbnails = getThumbnailLimits();
      return (
        <ExtractPdfPagesWorkspace
          limits={{
            maxFileSize: limits.maxFileSize,
            thumbnailMaxPages: thumbnails.maxPages,
          }}
        />
      );
    }
    case "delete-pdf-pages": {
      const limits = getProcessingLimits();
      const thumbnails = getThumbnailLimits();
      return (
        <DeletePdfPagesWorkspace
          limits={{
            maxFileSize: limits.maxFileSize,
            thumbnailMaxPages: thumbnails.maxPages,
          }}
        />
      );
    }
    case "rotate-pdf": {
      const limits = getProcessingLimits();
      const thumbnails = getThumbnailLimits();
      return (
        <RotatePdfWorkspace
          limits={{
            maxFileSize: limits.maxFileSize,
            thumbnailMaxPages: thumbnails.maxPages,
          }}
        />
      );
    }
    case "reorder-pdf-pages": {
      const limits = getProcessingLimits();
      const thumbnails = getThumbnailLimits();
      return (
        <ReorderPdfPagesWorkspace
          limits={{
            maxFileSize: limits.maxFileSize,
            thumbnailMaxPages: thumbnails.maxPages,
          }}
        />
      );
    }
    default:
      return null;
  }
}

const TOOLS_WITH_WORKSPACE = new Set([
  "images-to-pdf",
  "pdf-to-jpg",
  "pdf-to-png",
  "compress-pdf",
  "merge-pdf",
  "split-pdf",
  "extract-pdf-pages",
  "delete-pdf-pages",
  "reorder-pdf-pages",
  "rotate-pdf",
]);

export function hasToolWorkspace(toolId: string): boolean {
  return TOOLS_WITH_WORKSPACE.has(toolId);
}
