"use client";

import { PageSelectionWorkspace } from "@/components/tools/workspaces/page-selection-workspace";
import { runExtractPdfPages } from "@/lib/processing/client";
import { countPagesInRanges, PAGE_RANGE_SYNTAX_HINT } from "@/lib/processing/pages";

export interface ExtractPdfPagesWorkspaceProps {
  limits: { maxFileSize: number; thumbnailMaxPages: number };
}

/**
 * Extract PDF Pages: keep the selected pages, in the order they were selected.
 */
export function ExtractPdfPagesWorkspace({ limits }: ExtractPdfPagesWorkspaceProps) {
  return (
    <PageSelectionWorkspace
      limits={{ maxFileSize: limits.maxFileSize }}
      labels={{
        rangeLabel: "Pages to extract",
        rangePlaceholder: "1-3, 5, 8-10",
        rangeHelp: `Enter the page numbers or ranges to keep. ${PAGE_RANGE_SYNTAX_HINT}`,
        action: "Extract Pages",
        processing: "Extracting pages…",
        reset: "Extract another PDF",
        success: (pages) =>
          `Successfully extracted ${pages} ${pages === 1 ? "page" : "pages"}.`,
        successDetail: (pages, pageCount) =>
          `Your new PDF has ${pages} of the original ${pageCount} ${
            pageCount === 1 ? "page" : "pages"
          }, in the order you selected.`,
      }}
      summary={(ranges) => {
        const pages = countPagesInRanges(ranges);
        return (
          <>
            <strong className="font-medium text-foreground">
              {pages} {pages === 1 ? "page" : "pages"}
            </strong>{" "}
            will be extracted into one PDF, in the order you entered.
          </>
        );
      }}
      thumbnails={{
        maxPages: limits.thumbnailMaxPages,
        selectable: true,
        selectVerb: "extract",
      }}
      run={({ file, ranges, signal }) => runExtractPdfPages({ file, ranges, signal })}
    />
  );
}
