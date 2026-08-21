"use client";

import { Loader2 } from "lucide-react";
import { PdfPageThumbnail } from "@/components/tools/pdf-page-thumbnail";
import type { PageThumbnailData } from "@/lib/processing/client";

/**
 * Grid of real page previews.
 *
 * Two uses: a *selectable* picker (Extract, Delete) where clicking a page edits
 * the tool's page-range field, and read-only *context* (Split) where previews
 * simply show what the document contains.
 *
 * It is always an enhancement layered on a text field that already works: long
 * documents and preview failures fall back with an honest explanation instead
 * of fake page images.
 */
export interface PagePreviewGridProps {
  pageCount: number;
  /** Rendered previews, or `null` while they are still loading. */
  previews: PageThumbnailData[] | null;
  previewFailure?: string | null;
  /** Server preview limit; above it, previews are skipped entirely. */
  maxPages: number;
  selectable?: boolean;
  /** Accessible verb for the toggle, e.g. "extract" or "delete". */
  selectVerb?: string;
  selectedPages?: Set<number>;
  disabled?: boolean;
  onToggle?: (page: number) => void;
  /** Short line above the grid. */
  caption?: string;
}

export function PagePreviewGrid({
  pageCount,
  previews,
  previewFailure = null,
  maxPages,
  selectable = false,
  selectVerb = "select",
  selectedPages,
  disabled = false,
  onToggle,
  caption,
}: PagePreviewGridProps) {
  if (pageCount > maxPages) {
    return (
      <p className="mt-3 text-sm text-muted">
        This PDF has more pages than the {maxPages}-page preview limit, so page
        previews are not shown. The page range field works exactly the same way.
      </p>
    );
  }

  if (previewFailure) {
    return (
      <p className="mt-3 text-sm text-muted">
        Page previews couldn’t be generated ({previewFailure}) — you can still use the
        page range field.
      </p>
    );
  }

  if (!previews) {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted">
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        Generating page previews…
      </p>
    );
  }

  return (
    <div className="mt-4">
      {caption ? <p className="mb-2 text-sm text-muted">{caption}</p> : null}
      <ul
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
        data-testid="page-preview-grid"
      >
        {previews.map((preview) => {
          const selected = selectedPages?.has(preview.pageNumber) ?? false;
          return (
            <li
              key={preview.pageNumber}
              data-page={preview.pageNumber}
              data-selected={selected}
            >
              {selectable ? (
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onToggle?.(preview.pageNumber)}
                  className="w-full rounded-xl text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
                >
                  <span className="sr-only">
                    {selected
                      ? `Page ${preview.pageNumber} is selected to ${selectVerb}. Activate to remove it.`
                      : `Select page ${preview.pageNumber} to ${selectVerb}.`}
                  </span>
                  <PdfPageThumbnail
                    pageNumber={preview.pageNumber}
                    src={preview.dataUrl}
                    width={preview.width}
                    height={preview.height}
                    selected={selected}
                    badge={selected ? "Selected" : undefined}
                  />
                </button>
              ) : (
                <PdfPageThumbnail
                  pageNumber={preview.pageNumber}
                  src={preview.dataUrl}
                  width={preview.width}
                  height={preview.height}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
