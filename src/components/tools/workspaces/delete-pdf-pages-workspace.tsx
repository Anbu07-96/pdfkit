"use client";

import { PageSelectionWorkspace } from "@/components/tools/workspaces/page-selection-workspace";
import { runDeletePdfPages } from "@/lib/processing/client";
import { countPagesInRanges, PAGE_RANGE_SYNTAX_HINT } from "@/lib/processing/pages";

export interface DeletePdfPagesWorkspaceProps {
  limits: { maxFileSize: number };
}

/**
 * Delete PDF Pages: remove the selected pages and keep the rest, in the
 * original document order. Removing every page is blocked here and rejected
 * again by the server.
 */
export function DeletePdfPagesWorkspace({ limits }: DeletePdfPagesWorkspaceProps) {
  return (
    <PageSelectionWorkspace
      limits={limits}
      labels={{
        rangeLabel: "Pages to delete",
        rangePlaceholder: "2, 4, 7-9",
        rangeHelp: `Enter the pages or ranges you want to remove. ${PAGE_RANGE_SYNTAX_HINT}`,
        action: "Delete Pages",
        processing: "Removing selected pages…",
        reset: "Delete pages from another PDF",
        success: (remaining) =>
          `Successfully removed pages. ${remaining} ${
            remaining === 1 ? "page remains" : "pages remain"
          }.`,
        successDetail: (remaining, pageCount) =>
          `Your new PDF has ${remaining} of the original ${pageCount} ${
            pageCount === 1 ? "page" : "pages"
          }, in the original order.`,
      }}
      extraValidation={(ranges, pageCount) =>
        countPagesInRanges(ranges) >= pageCount
          ? "You must keep at least one page. Deselect at least one page and try again."
          : null
      }
      summary={(ranges, pageCount) => {
        const removed = countPagesInRanges(ranges);
        const remaining = pageCount - removed;
        return (
          <>
            <strong className="font-medium text-foreground">
              {removed} {removed === 1 ? "page" : "pages"}
            </strong>{" "}
            will be removed.{" "}
            <strong className="font-medium text-foreground">
              {remaining} {remaining === 1 ? "page" : "pages"}
            </strong>{" "}
            will remain.
          </>
        );
      }}
      run={({ file, ranges, signal }) => runDeletePdfPages({ file, ranges, signal })}
    />
  );
}
