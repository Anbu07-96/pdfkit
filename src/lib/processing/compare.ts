import "server-only";

export interface DocumentComparisonResult {
  docAName: string;
  docBName: string;
  pageCountA: number;
  pageCountB: number;
  identicalPageCount: boolean;
  pageDiffs: Array<{
    pageNumber: number;
    identical: boolean;
    textA: string;
    textB: string;
  }>;
}

/**
 * Compare page texts between two documents line by line.
 */
export function comparePageTexts(
  docAName: string,
  docBName: string,
  textsA: string[],
  textsB: string[],
): DocumentComparisonResult {
  const pageCountA = textsA.length;
  const pageCountB = textsB.length;
  const maxPages = Math.max(pageCountA, pageCountB);

  const pageDiffs: DocumentComparisonResult["pageDiffs"] = [];

  for (let i = 0; i < maxPages; i++) {
    const textA = textsA[i] || "";
    const textB = textsB[i] || "";
    const identical = textA.trim() === textB.trim();

    pageDiffs.push({
      pageNumber: i + 1,
      identical,
      textA,
      textB,
    });
  }

  return {
    docAName,
    docBName,
    pageCountA,
    pageCountB,
    identicalPageCount: pageCountA === pageCountB,
    pageDiffs,
  };
}

/**
 * Formats a human-readable comparison summary report.
 */
export function formatComparisonReport(result: DocumentComparisonResult): string {
  const lines: string[] = [];
  lines.push("==================================================");
  lines.push("PDFKit Document Comparison Report");
  lines.push("==================================================");
  lines.push(`Document A: ${result.docAName} (${result.pageCountA} pages)`);
  lines.push(`Document B: ${result.docBName} (${result.pageCountB} pages)`);
  lines.push(`Page Count Status: ${result.identicalPageCount ? "Identical" : "Different"}`);
  lines.push("--------------------------------------------------");

  let modifiedPagesCount = 0;
  for (const diff of result.pageDiffs) {
    if (!diff.identical) {
      modifiedPagesCount++;
      lines.push(`\n[Page ${diff.pageNumber} Differences]`);
      lines.push(`--- Document A (Page ${diff.pageNumber}) ---`);
      lines.push(diff.textA || "[Page missing or empty in Document A]");
      lines.push(`--- Document B (Page ${diff.pageNumber}) ---`);
      lines.push(diff.textB || "[Page missing or empty in Document B]");
    }
  }

  if (modifiedPagesCount === 0 && result.identicalPageCount) {
    lines.push("\nResult: Documents are identical in text content and page count.");
  } else {
    lines.push(`\nResult: Found differences across ${modifiedPagesCount} page(s).`);
  }

  return lines.join("\n");
}
