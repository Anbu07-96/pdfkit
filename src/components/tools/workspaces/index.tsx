import { DeletePdfPagesWorkspace } from "@/components/tools/workspaces/delete-pdf-pages-workspace";
import { ExtractPdfPagesWorkspace } from "@/components/tools/workspaces/extract-pdf-pages-workspace";
import { MergePdfWorkspace } from "@/components/tools/workspaces/merge-pdf-workspace";
import { SplitPdfWorkspace } from "@/components/tools/workspaces/split-pdf-workspace";
import { getProcessingLimits } from "@/lib/processing/limits";
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
      return (
        <SplitPdfWorkspace
          limits={{
            maxFileSize: limits.maxFileSize,
            maxOutputs: limits.maxOutputs,
          }}
        />
      );
    }
    case "extract-pdf-pages": {
      const limits = getProcessingLimits();
      return <ExtractPdfPagesWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    case "delete-pdf-pages": {
      const limits = getProcessingLimits();
      return <DeletePdfPagesWorkspace limits={{ maxFileSize: limits.maxFileSize }} />;
    }
    default:
      return null;
  }
}

const TOOLS_WITH_WORKSPACE = new Set([
  "merge-pdf",
  "split-pdf",
  "extract-pdf-pages",
  "delete-pdf-pages",
]);

export function hasToolWorkspace(toolId: string): boolean {
  return TOOLS_WITH_WORKSPACE.has(toolId);
}
