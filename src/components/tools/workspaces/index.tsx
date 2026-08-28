import { AddImagesWorkspace } from "@/components/tools/workspaces/add-images-workspace";
import { AddShapesWorkspace } from "@/components/tools/workspaces/add-shapes-workspace";
import { AddTextWorkspace } from "@/components/tools/workspaces/add-text-workspace";
import { AnnotationsWorkspace } from "@/components/tools/workspaces/annotations-workspace";
import { DrawWorkspace } from "@/components/tools/workspaces/draw-workspace";
import { CompressPdfWorkspace } from "@/components/tools/workspaces/compress-pdf-workspace";
import { EditPdfMetadataWorkspace } from "@/components/tools/workspaces/edit-pdf-metadata-workspace";
import { RemoveMetadataWorkspace } from "@/components/tools/workspaces/remove-metadata-workspace";
import { ImagesToPdfWorkspace } from "@/components/tools/workspaces/images-to-pdf-workspace";
import { PdfToImageWorkspace } from "@/components/tools/workspaces/pdf-to-image-workspace";
import { PdfToWordWorkspace } from "@/components/tools/workspaces/pdf-to-word-workspace";
import { PngToPdfWorkspace } from "@/components/tools/workspaces/png-to-pdf-workspace";
import { WatermarkWorkspace } from "@/components/tools/workspaces/watermark-workspace";
import { PageNumbersWorkspace } from "@/components/tools/workspaces/page-numbers-workspace";
import { PasswordProtectWorkspace } from "@/components/tools/workspaces/password-protect-workspace";
import { CropWorkspace } from "@/components/tools/workspaces/crop-workspace";
import { FlattenPdfWorkspace } from "@/components/tools/workspaces/flatten-pdf-workspace";
import { HighlightWorkspace } from "@/components/tools/workspaces/highlight-workspace";
import { DeletePdfPagesWorkspace } from "@/components/tools/workspaces/delete-pdf-pages-workspace";
import { ExtractImagesWorkspace } from "@/components/tools/workspaces/extract-images-workspace";
import { PdfToTextWorkspace } from "@/components/tools/workspaces/pdf-to-text-workspace";
import { ExtractPdfPagesWorkspace } from "@/components/tools/workspaces/extract-pdf-pages-workspace";
import { MergePdfWorkspace } from "@/components/tools/workspaces/merge-pdf-workspace";
import { ReorderPdfPagesWorkspace } from "@/components/tools/workspaces/reorder-pdf-pages-workspace";
import { OrganizePdfWorkspace } from "@/components/tools/workspaces/organize-pdf-workspace";
import { RotatePdfWorkspace } from "@/components/tools/workspaces/rotate-pdf-workspace";
import { SplitPdfWorkspace } from "@/components/tools/workspaces/split-pdf-workspace";
import { CompareDocumentsWorkspace } from "@/components/tools/workspaces/compare-documents-workspace";
import { ExtractTablesWorkspace } from "@/components/tools/workspaces/extract-tables-workspace";
import { PdfToExcelWorkspace } from "@/components/tools/workspaces/pdf-to-excel-workspace";
import { RedactWorkspace } from "@/components/tools/workspaces/redact-workspace";
import { UnlockPdfWorkspace } from "@/components/tools/workspaces/unlock-pdf-workspace";
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
    case "remove-metadata": {
      const limits = getProcessingLimits();
      return <RemoveMetadataWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "crop": {
      const limits = getProcessingLimits();
      return <CropWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "flatten-pdf": {
      const limits = getProcessingLimits();
      return <FlattenPdfWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "page-numbers": {
      const limits = getProcessingLimits();
      return <PageNumbersWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "password-protect": {
      const limits = getProcessingLimits();
      return (
        <PasswordProtectWorkspace limits={{ maxFileSize: limits.maxFileSize }} />
      );
    }
    case "unlock-pdf": {
      const limits = getProcessingLimits();
      return <UnlockPdfWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "redact-information": {
      return <RedactWorkspace />;
    }
    case "extract-tables": {
      return <ExtractTablesWorkspace />;
    }
    case "pdf-to-excel": {
      return <PdfToExcelWorkspace />;
    }
    case "compare-documents": {
      return <CompareDocumentsWorkspace />;
    }
    case "watermark": {
      const limits = getProcessingLimits();
      return <WatermarkWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "add-shapes": {
      const limits = getProcessingLimits();
      return <AddShapesWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "add-images": {
      const limits = getProcessingLimits();
      return <AddImagesWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "highlight": {
      const limits = getProcessingLimits();
      return <HighlightWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "draw": {
      const limits = getProcessingLimits();
      return <DrawWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "annotations": {
      const limits = getProcessingLimits();
      return <AnnotationsWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "extract-images": {
      const limits = getProcessingLimits();
      return <ExtractImagesWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "pdf-to-text": {
      const limits = getProcessingLimits();
      return <PdfToTextWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "add-text": {
      const limits = getProcessingLimits();
      return <AddTextWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "png-to-pdf": {
      const limits = getProcessingLimits();
      return (
        <PngToPdfWorkspace
          limits={{
            maxFiles: limits.maxFiles,
            maxFileSize: limits.maxFileSize,
          }}
        />
      );
    }
    case "pdf-to-word": {
      const limits = getProcessingLimits();
      return (
        <PdfToWordWorkspace
          limits={{
            maxFileSize: limits.maxFileSize,
            maxPages: limits.maxConversionPages,
          }}
        />
      );
    }
    case "edit-pdf-metadata": {
      const limits = getProcessingLimits();
      return <EditPdfMetadataWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
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
    case "organize-pdf": {
      const limits = getProcessingLimits();
      const thumbnails = getThumbnailLimits();
      return (
        <OrganizePdfWorkspace
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
