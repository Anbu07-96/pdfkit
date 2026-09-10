import "server-only";

import type { BenchmarkFixture } from "@/lib/benchmarks/types";
import { normalizeWhitespace } from "@/lib/benchmarks/fixtures";

/**
 * Benchmark metrics (Phase 71 foundation, expanded in Phase 72).
 *
 * Every metric is labeled OBJECTIVE (mechanically measurable, no judgement)
 * or HEURISTIC (an informative signal whose interpretation involves a
 * convention). No metric is called "fidelity" — fidelity claims require the
 * Stage 4 benchmark campaign on the full corpus.
 *
 * Metric ids (stable, machine-readable):
 *
 * | id | label | definition |
 * | --- | --- | --- |
 * | output.exists | OBJECTIVE | at least one artifact was produced |
 * | output.count | OBJECTIVE | number of artifacts |
 * | output.bytes | OBJECTIVE | total produced bytes |
 * | text.characterCount | OBJECTIVE | characters in text/* outputs, markers included (Phase 71 semantics) |
 * | text.anchorPreservation | OBJECTIVE | planted synthetic anchors present in text output (0–1); this IS anchor recall |
 * | text.anchorPrecision | OBJECTIVE | anchor-shaped tokens in the output that are expected anchors (0–1); detects fabrication/duplication |
 * | text.readingOrderAccuracy | OBJECTIVE | consecutive ground-truth anchor pairs (both present) in reading order (0–1) |
 * | text.tokenRecall | OBJECTIVE | expected word tokens present with token boundaries (0–1) |
 * | text.unexpectedTokenCount | OBJECTIVE | word tokens in the output that no ground-truth content explains |
 * | text.characterRatio | OBJECTIVE | normalized output characters / ground-truth character count |
 * | text.whitespaceNormalizedExactness | OBJECTIVE | 1 when the normalized output equals the canonical text, else 0 |
 * | text.unicodePreservation | OBJECTIVE | expected non-ASCII letters/symbols present in the output (0–1) |
 * | text.pageCoverage | OBJECTIVE | page markers found / expected pages (0–1) |
 * | text.blankPageCorrectness | OBJECTIVE | expected text-empty pages (blank or image-only) that carry no planted content (0–1) |
 * | text.columnOrderPreserved | OBJECTIVE* | left-anchor precedes its right-anchor per planted pair (0–1); *the pair convention is defined by the fixture, the index comparison is mechanical |
 * | table.rowsExtracted | OBJECTIVE | rows reported by the engine meta, when present |
 * | table.cellTokenRecall | OBJECTIVE | expected table cells present in the CSV output (0–1) |
 * | table.rowCountRatio | OBJECTIVE | detected CSV data rows / expected rows |
 * | table.rowGroupingAccuracy | HEURISTIC | expected rows whose full cell set matches one detected row (0–1); grouping conventions are ours, not the engines' |
 * | images.extracted | OBJECTIVE | images reported by the engine meta, when present |
 * | failure.errorCategory | OBJECTIVE | typed error code on failure ("NON_TYPED_ERROR" otherwise) |
 * | failure.benchmarkCategory | OBJECTIVE | failure mapped onto the Phase 72 benchmark taxonomy (codes only) |
 * | performance.wallClockMs | OBJECTIVE | measured wall time (measurement, not a quality claim) |
 * | performance.heapDeltaBytes | HEURISTIC | process.memoryUsage heap delta — noisy, indicative only |
 *
 * Layout metrics note (§8 of the phase spec): the CURRENT engine's text
 * output carries no positional information, so direct engine-vs-engine
 * X/Y-ordering comparison is NOT MEASURABLE. The comparable, objective
 * proxies are readingOrderAccuracy / columnOrderPreserved, which measure
 * the ORDER the reconstructed output exhibits. No positional score is
 * invented for engines that do not expose positions.
 *
 * Proposed Stage 4 comparison thresholds for these metrics live in
 * docs/benchmark-plan.md as DRAFT — none are enforced here.
 */

/** Structural lines both engines legitimately add; stripped before content
 * metrics so marker conventions never count as content. */
const PAGE_MARKER_LINE = /^--- Page \d+ ---$/gm;
const NO_TEXT_LINE = /^\[Page \d+ contains no extractable text\]$/gm;

/** Anchor shape (the corpus convention: PDFKIT-* tokens, any case). */
const ANCHOR_SHAPE = /PDFKIT-[A-Za-z0-9-]+/g;

/** Word tokenizer for token metrics (unicode letters and numbers). */
const WORD_TOKEN = /[\p{L}\p{N}]+/gu;

function stripStructuralLines(text: string): string {
  return text.replace(PAGE_MARKER_LINE, "").replace(NO_TEXT_LINE, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Is `token` present in `text` as a token (not inside a longer token)? */
function hasToken(text: string, token: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, "u").test(
    text,
  );
}

function wordTokens(text: string): string[] {
  return text.match(WORD_TOKEN) ?? [];
}

/** Decode the text content of text/* artifacts (bounded by artifact size). */
function extractText(artifacts: readonly { mimeType: string; bytes: Uint8Array }[]): string {
  const decoder = new TextDecoder();
  let text = "";
  for (const artifact of artifacts) {
    if (artifact.mimeType.toLowerCase().startsWith("text/")) {
      text += decoder.decode(artifact.bytes);
    }
  }
  return text;
}

/** Count `--- Page N ---` markers in a text output (current convention). */
function countPageMarkers(text: string): number {
  const matches = text.match(/--- Page \d+ ---/g);
  return matches ? matches.length : 0;
}

/** Map page numbers to their output section (text after the page marker). */
function pageSections(text: string): Map<number, string> {
  const sections = new Map<number, string>();
  const marker = /--- Page (\d+) ---/g;
  let match: RegExpExecArray | null;
  const found: { page: number; start: number; end: number }[] = [];
  while ((match = marker.exec(text)) !== null) {
    found.push({
      page: Number(match[1]),
      start: match.index + match[0].length,
      end: -1,
    });
    if (found.length > 1) found[found.length - 2].end = match.index;
  }
  if (found.length > 0) found[found.length - 1].end = text.length;
  for (const entry of found) {
    sections.set(entry.page, text.slice(entry.start, entry.end));
  }
  return sections;
}

/**
 * Parse table rows out of a CSV/text table output. Handles both the current
 * engine's CSV convention (quoted cells, comma-separated) and plain text
 * rows whose cells are separated by 2+ spaces.
 */
export function parseTableRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("--- Page ")) continue;
    if (line.includes('","')) {
      const cells = line
        .split(",")
        .map((cell) => cell.replace(/^"|"$/g, "").replace(/""/g, '"').trim())
        .filter((cell) => cell.length > 0);
      if (cells.length > 0) rows.push(cells);
    } else {
      const cells = line
        .split(/\s{2,}/)
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);
      if (cells.length > 0) rows.push(cells);
    }
  }
  return rows;
}

export interface MetricComputationInput {
  readonly fixture: BenchmarkFixture;
  readonly artifacts: readonly { name: string; mimeType: string; size: number; bytes: Uint8Array }[];
  readonly meta?: Record<string, number | string>;
}

/** Compute the applicable metrics for one benchmark run. Never throws. */
export function computeMetrics({
  fixture,
  artifacts,
  meta,
}: MetricComputationInput): Record<string, number | boolean | string> {
  const metrics: Record<string, number | boolean | string> = {};

  metrics["output.exists"] = artifacts.length > 0;
  metrics["output.count"] = artifacts.length;
  metrics["output.bytes"] = artifacts.reduce(
    (total, artifact) => total + artifact.size,
    0,
  );

  const rawText = extractText(artifacts);
  const hasTextArtifact = artifacts.some((a) =>
    a.mimeType.toLowerCase().startsWith("text/"),
  );
  const hasCsvArtifact = artifacts.some((a) =>
    a.mimeType.toLowerCase().startsWith("text/csv"),
  );

  if (artifacts.length > 0 && hasTextArtifact) {
    const content = stripStructuralLines(rawText);
    const normalized = normalizeWhitespace(content);
    // Phase 71 semantics: raw characters in text/* outputs (structural
    // markers included). The normalized CONTENT length is used internally
    // by characterRatio / whitespaceNormalizedExactness.
    metrics["text.characterCount"] = rawText.length;

    const anchors = fixture.expected.anchors;

    // Anchor recall (a.k.a. anchorPreservation — the Phase 71 id).
    if (anchors.length > 0) {
      const preserved = anchors.filter((anchor) => rawText.includes(anchor)).length;
      metrics["text.anchorPreservation"] = preserved / anchors.length;
    }

    // Anchor precision: fabricated or unexpected anchor-shaped tokens.
    const detectedAnchors = new Set(rawText.match(ANCHOR_SHAPE) ?? []);
    if (detectedAnchors.size > 0 && anchors.length > 0) {
      const expectedSet = new Set(anchors);
      let expectedFound = 0;
      for (const detected of detectedAnchors) {
        if (expectedSet.has(detected)) expectedFound += 1;
      }
      metrics["text.anchorPrecision"] = expectedFound / detectedAnchors.size;
    }

    // Reading order over consecutive ground-truth anchor pairs.
    const ordered = fixture.expected.orderedAnchors;
    if (ordered && ordered.length >= 2) {
      let pairsPresent = 0;
      let pairsInOrder = 0;
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const left = rawText.indexOf(ordered[index]);
        const right = rawText.indexOf(ordered[index + 1]);
        if (left >= 0 && right >= 0) {
          pairsPresent += 1;
          if (left < right) pairsInOrder += 1;
        }
      }
      if (pairsPresent > 0) {
        metrics["text.readingOrderAccuracy"] = pairsInOrder / pairsPresent;
      }
    }

    // Expected-token recall and unexpected-token count.
    const expectedTokens = fixture.expected.tokens ?? [];
    const canonical = fixture.expected.canonicalText;
    if (expectedTokens.length > 0) {
      const found = expectedTokens.filter((token) => hasToken(normalized, token)).length;
      metrics["text.tokenRecall"] = found / expectedTokens.length;
    }

    const universe = new Set<string>([
      ...wordTokens(anchors.join(" ")),
      ...wordTokens(expectedTokens.join(" ")),
      ...(canonical ? wordTokens(canonical) : []),
      ...(fixture.expected.table
        ? wordTokens(fixture.expected.table.rows.map((row) => row.join(" ")).join(" "))
        : []),
    ]);
    if (universe.size > 0) {
      metrics["text.unexpectedTokenCount"] = wordTokens(normalized).filter(
        (token) => !universe.has(token),
      ).length;
    }

    // Character ratio and normalized exactness against canonical text.
    const expectedChars = fixture.expected.characterCount;
    if (typeof expectedChars === "number" && expectedChars > 0) {
      metrics["text.characterRatio"] = normalized.length / expectedChars;
    }
    if (canonical) {
      metrics["text.whitespaceNormalizedExactness"] =
        normalized === normalizeWhitespace(canonical) ? 1 : 0;
    }

    // Unicode + symbol preservation.
    const specialChars = [
      ...(fixture.expected.unicodeChars ?? []),
      ...(fixture.expected.symbolChars ?? []),
    ];
    if (specialChars.length > 0) {
      const present = specialChars.filter((char) => rawText.includes(char)).length;
      metrics["text.unicodePreservation"] = present / specialChars.length;
    }

    // Page coverage.
    if (fixture.expected.pageCount > 0) {
      const markers = countPageMarkers(rawText);
      metrics["text.pageCoverage"] =
        markers === 0 ? 0 : Math.min(1, markers / fixture.expected.pageCount);
    }

    // Blank / image-only page correctness: no planted content allowed there.
    const expectedEmptyPages = [
      ...(fixture.expected.imageOnlyPages ?? []),
      ...(fixture.expected.blankPages ?? []),
    ];
    if (expectedEmptyPages.length > 0) {
      const sections = pageSections(rawText);
      const allExpectedContent = [...anchors, ...expectedTokens];
      let correct = 0;
      for (const page of expectedEmptyPages) {
        const section = sections.get(page);
        if (section === undefined) continue;
        const sectionContent = stripStructuralLines(section);
        const carriesContent = allExpectedContent.some((token) =>
          sectionContent.includes(token),
        );
        if (!carriesContent) correct += 1;
      }
      metrics["text.blankPageCorrectness"] = correct / expectedEmptyPages.length;
    }

    // Column pairs (the Phase 71 id).
    const pairs = fixture.expected.columnPairs;
    if (pairs && pairs.length > 0) {
      let orderedPairs = 0;
      for (const [left, right] of pairs) {
        const leftIndex = rawText.indexOf(left);
        const rightIndex = rawText.indexOf(right);
        if (leftIndex >= 0 && rightIndex >= 0 && leftIndex < rightIndex) {
          orderedPairs += 1;
        }
      }
      metrics["text.columnOrderPreserved"] = orderedPairs / pairs.length;
    }
  }

  // Table ground-truth metrics — only for CSV table outputs (§10). This is
  // component-level evidence for the candidate, never full-engine
  // equivalence (the candidate does not implement table reconstruction).
  const table = fixture.expected.table;
  if (table && table.rows.length > 0 && hasCsvArtifact) {
    const rows = parseTableRows(rawText);
    const expectedCells = table.rows.flat();
    const foundCells = expectedCells.filter((cell) => rawText.includes(cell)).length;
    metrics["table.cellTokenRecall"] = foundCells / expectedCells.length;
    metrics["table.rowCountRatio"] = rows.length / table.rows.length;

    const expectedRowSets = table.rows.map((row) => new Set(row));
    let matched = 0;
    for (const expectedSet of expectedRowSets) {
      if (
        rows.some(
          (row) =>
            row.length === expectedSet.size &&
            row.every((cell) => expectedSet.has(cell)),
        )
      ) {
        matched += 1;
      }
    }
    metrics["table.rowGroupingAccuracy"] = matched / expectedRowSets.length;
  }

  if (typeof meta?.rowsExtracted === "number") {
    metrics["table.rowsExtracted"] = meta.rowsExtracted;
  }
  if (typeof meta?.extractedImagesCount === "number") {
    metrics["images.extracted"] = meta.extractedImagesCount;
  }

  return metrics;
}

/**
 * Categorise a benchmark failure by typed error code (codes only). PDF.js
 * exception names are recognised so candidate failures stay typed — this
 * mapping lives entirely in benchmark code; the production taxonomy is
 * untouched.
 */
export function errorCategory(error: unknown): string {
  if (error && typeof error === "object") {
    if ("code" in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && code.length > 0) return code;
    }
    if ("name" in error) {
      const name = (error as { name?: unknown }).name;
      if (
        typeof name === "string" &&
        /^(InvalidPDFException|MissingPDFException|PasswordException|UnexpectedResponseException)$/.test(
          name,
        )
      ) {
        return name;
      }
    }
  }
  return "NON_TYPED_ERROR";
}

/**
 * Map a typed error category onto the Phase 72 benchmark failure taxonomy
 * (§13): parse-failure | malformed-input | unsupported-input | input-limit |
 * output-limit | output-invalid | timeout | memory-limit | processing-failure
 * | non-typed-error. Codes only — never content.
 */
export function benchmarkFailureCategory(category: string): string {
  switch (category) {
    case "INVALID_PDF":
    case "InvalidPDFException":
    case "MissingPDFException":
      return "malformed-input";
    case "ENCRYPTED_PDF":
    case "WRONG_PASSWORD":
    case "UNSUPPORTED_ENCRYPTION":
    case "PasswordException":
    case "UNSUPPORTED_FILE":
      return "unsupported-input";
    case "FILE_TOO_LARGE":
    case "TOTAL_SIZE_EXCEEDED":
      return "input-limit";
    case "TOO_MANY_OUTPUTS":
    case "OUTPUT_TOO_LARGE":
      return "output-limit";
    case "VALIDATION_ERROR":
      return "output-invalid";
    case "REQUEST_TIMEOUT":
      return "timeout";
    case "FILE_TOO_LARGE_MEMORY":
      return "memory-limit";
    case "PROCESSING_ERROR":
    case "INTERNAL_ERROR":
    case "UnexpectedResponseException":
      return "processing-failure";
    default:
      return "non-typed-error";
  }
}
