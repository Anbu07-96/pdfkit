import "server-only";

import type { DocumentProfile } from "@/lib/engines/profile";
import type { ConversionType, OutputValidationState } from "@/lib/engines/types";

/**
 * QualityGate v1 (Phase 69, Stage 3).
 *
 * A conservative, conversion-aware, **diagnostic-only** quality assessment
 * that runs after every successful engine execution:
 *
 * ```text
 * Engine → OutputValidator (structural) → QualityGate (quality) → verdict
 * ```
 *
 * ## What it answers
 *
 * "Given the conversion result and the signals already available, does this
 * result appear healthy, suspicious, or is there insufficient evidence?"
 *
 * ## What it deliberately does NOT do
 *
 * - It does NOT reject output, fail jobs, change status codes or alter the
 *   result in any way — a `suspicious` verdict is recorded, never enforced.
 * - It does NOT decide whether another engine should run (Stage 4,
 *   PLANNED).
 * - It does NOT pretend to measure document fidelity: no visual, semantic,
 *   layout, table-accuracy or OCR metrics exist here. The score is a
 *   weighted index over a handful of honest, cheap signals — nothing more.
 *
 * ## Signals (all already computed — zero extra parsing)
 *
 * The gate consumes only what the request already produced: the
 * signature-tier `DocumentProfile`, the Stage 2 structural validation
 * verdict, the processor's own meta (character/row/image/page counts) and
 * the artifact facts. It never re-parses the input, never decompresses
 * output containers, never renders. When a signal is unavailable (the live
 * path does not resolve full profiles), the check is recorded as
 * `not-evaluated` — `unknown > false precision`. A full `DocumentProfile`
 * may be supplied by callers that legitimately have one (tests, later
 * stages); the policy simply uses the richer signals when present.
 *
 * ## Privacy
 *
 * Results contain a typed state, a numeric score, check ids, short
 * non-sensitive reason strings (counts only) and a version. Never document
 * contents, extracted text, names or metadata values.
 */

/** Bump when the policy changes. Scores from different policy versions are
 * diagnostic indices, not comparable measurements. */
export const QUALITY_VERSION = 1 as const;

/**
 * - `healthy` — available signals are consistent with a good conversion.
 * - `suspicious` — technically valid, but a measurable signal indicates the
 *   quality may be poor or incomplete. NOT a failure.
 * - `insufficient` — too little evidence for a meaningful determination.
 *   NOT a failure either: a conversion can succeed with insufficient
 *   evidence.
 * - `not-evaluated` — the gate did not run (no policy for the type).
 */
export type QualityState =
  | "not-evaluated"
  | "healthy"
  | "suspicious"
  | "insufficient";

export type QualityCheckState = "pass" | "warn" | "not-evaluated";

export interface QualityCheck {
  /** Stable check identifier, e.g. "source-text-availability". */
  readonly id: string;
  readonly state: QualityCheckState;
  /**
   * Contribution to the score. 0 marks by-design-unmeasurable checks
   * (compression fidelity, semantic fidelity): they are recorded for
   * honesty but excluded from the score and from the sufficiency math.
   */
  readonly weight: number;
  /** Short, non-sensitive reason. Counts are fine; content never is. */
  readonly reason: string;
}

export interface QualityAssessment {
  readonly qualityVersion: typeof QUALITY_VERSION;
  readonly state: QualityState;
  /**
   * 0–100 heuristic index: the share of evaluated weight that passed. It is
   * NOT a fidelity percentage and must not be presented as one.
   */
  readonly score: number;
  readonly checks: readonly QualityCheck[];
}

/** Everything the gate may consume — all of it already in hand. */
export interface QualityAssessmentInput {
  /** Signature tier in the live path; a full profile is welcome when real. */
  readonly profile?: DocumentProfile;
  /** Stage 2 structural verdict. */
  readonly validation: OutputValidationState;
  /** The processor's own meta (counts) — already computed. */
  readonly meta?: Record<string, number | string>;
  /** Number of produced artifacts. */
  readonly artifactCount: number;
  /** Total produced bytes. */
  readonly outputBytes: number;
  /** Number of input files in the request. */
  readonly inputFileCount: number;
  /**
   * Derived, non-sensitive fact (computed where the output content already
   * lives): true when the text output consists entirely of the
   * implementation's page markers, i.e. no source text was extracted.
   * Absent when not applicable or not computable. Never content itself.
   */
  readonly outputTextMarkerOnly?: boolean;
}

/* ------------------------------------------------------------------ */
/* Check builders                                                      */
/* ------------------------------------------------------------------ */

function pass(id: string, weight: number, reason: string): QualityCheck {
  return { id, state: "pass", weight, reason };
}

function warn(id: string, weight: number, reason: string): QualityCheck {
  return { id, state: "warn", weight, reason };
}

function notEval(id: string, weight: number, reason: string): QualityCheck {
  return { id, state: "not-evaluated", weight, reason };
}

/** A check that is unmeasurable by design: weight 0, always not-evaluated. */
function immaterial(id: string, reason: string): QualityCheck {
  return { id, state: "not-evaluated", weight: 0, reason };
}

/** Read a numeric meta value, ignoring non-numbers. */
function metaNumber(
  meta: Record<string, number | string> | undefined,
  key: string,
): number | undefined {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/* ------------------------------------------------------------------ */
/* Common checks (every conversion)                                    */
/* ------------------------------------------------------------------ */

function commonChecks(input: QualityAssessmentInput): QualityCheck[] {
  const checks: QualityCheck[] = [];

  checks.push(
    input.artifactCount > 0
      ? pass(
          "output-count",
          2,
          `the conversion produced ${input.artifactCount} artifact(s)`,
        )
      : warn("output-count", 2, "the conversion produced no artifacts"),
  );

  if (input.validation.status === "passed") {
    checks.push(
      pass(
        "output-structurally-valid",
        3,
        "every artifact passed structural validation",
      ),
    );
  } else if (input.validation.status === "failed") {
    checks.push(
      warn(
        "output-structurally-valid",
        3,
        "one or more artifacts failed structural validation",
      ),
    );
  } else {
    checks.push(
      notEval(
        "output-structurally-valid",
        3,
        "the output class has no structural checks",
      ),
    );
  }

  return checks;
}

/* ------------------------------------------------------------------ */
/* Conversion-specific policies                                        */
/* ------------------------------------------------------------------ */

/**
 * Text-extraction conversions (pdf-to-word, pdf-to-text).
 *
 * A source with extractable text should yield output that carries text. A
 * scanned/image-only source legitimately yields little or no text (no OCR
 * exists) — that is flagged `suspicious` (an honest diagnostic), never as a
 * failure.
 */
function textExtractionChecks(
  input: QualityAssessmentInput,
  options: { contentKey?: "characters"; outputIsText?: boolean },
): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const profile = input.profile;

  // Source text availability (needs profile text signals; the live path
  // has only the signature tier, so this is often not-evaluated there).
  if (profile?.textPageCount !== undefined) {
    checks.push(
      profile.textPageCount > 0
        ? pass(
            "source-text-availability",
            2,
            `the source has extractable text on ${profile.textPageCount} of ${profile.pageCount ?? "?"} page(s)`,
          )
        : warn(
            "source-text-availability",
            2,
            "the source has no extractable text — it is likely scanned or image-only, and no OCR is available",
          ),
    );
  } else if (
    profile &&
    (profile.analysisState === "encrypted-input" ||
      profile.analysisState === "unreadable-input")
  ) {
    checks.push(
      notEval(
        "source-text-availability",
        2,
        "source text cannot be analysed for this input",
      ),
    );
  } else {
    checks.push(
      notEval(
        "source-text-availability",
        2,
        "source text availability was not profiled",
      ),
    );
  }

  // Output content volume: from the processor's own character count
  // (pdf-to-word) or the produced bytes (pdf-to-text, whose artifact IS
  // the text).
  if (options.contentKey) {
    const characters = metaNumber(input.meta, options.contentKey);
    if (characters !== undefined) {
      checks.push(
        characters > 0
          ? pass(
              "output-content-volume",
              2,
              `the output carries ${characters} extracted character(s)`,
            )
          : warn(
              "output-content-volume",
              2,
              "no text characters were extracted into the output",
            ),
      );
    } else {
      checks.push(
        notEval("output-content-volume", 2, "output content volume is unknown"),
      );
    }
  } else if (options.outputIsText) {
    if (input.outputTextMarkerOnly === true) {
      checks.push(
        warn(
          "output-content-volume",
          2,
          "the text output contains only page markers — no source text was extracted",
        ),
      );
    } else if (input.outputBytes > 0) {
      // When the source text volume is known (full profile), an output far
      // smaller than that volume is a measurable mismatch.
      const sourceCharacters = profile?.textCharacterCount;
      if (
        sourceCharacters !== undefined &&
        sourceCharacters > 1000 &&
        input.outputBytes < sourceCharacters * 0.05
      ) {
        checks.push(
          warn(
            "output-content-volume",
            2,
            "the text output is far smaller than the source text volume",
          ),
        );
      } else {
        checks.push(
          pass(
            "output-content-volume",
            2,
            `the text output carries ${input.outputBytes} byte(s)`,
          ),
        );
      }
    } else {
      checks.push(
        warn("output-content-volume", 2, "the text output is empty"),
      );
    }
  }

  return checks;
}

/**
 * Table conversions (pdf-to-excel, extract-tables) — deliberately
 * conservative: sparse documents and image-only documents legitimately
 * produce no rows, so the content signal carries a low weight and an
 * explanatory reason rather than a hard judgement.
 */
function tableChecks(input: QualityAssessmentInput): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const profile = input.profile;

  if (profile?.textPageCount !== undefined) {
    checks.push(
      profile.textPageCount > 0
        ? pass(
            "source-text-availability",
            1,
            `the source has extractable text on ${profile.textPageCount} page(s)`,
          )
        : notEval(
            "source-text-availability",
            1,
            "the source has no extractable text; table detection is not meaningful without it",
          ),
    );
  } else {
    checks.push(
      notEval("source-text-availability", 1, "source text was not profiled"),
    );
  }

  const rows = metaNumber(input.meta, "rowsExtracted");
  if (rows !== undefined) {
    if (rows > 0) {
      checks.push(
        pass(
          "table-content-volume",
          1,
          `${rows} table row(s) were extracted`,
        ),
      );
    } else if (profile?.textPageCount === 0) {
      checks.push(
        notEval(
          "table-content-volume",
          1,
          "no rows were detected and the source has no extractable text, which is expected",
        ),
      );
    } else {
      checks.push(
        warn(
          "table-content-volume",
          1,
          "no table rows were detected — the source may not contain tables",
        ),
      );
    }
  } else {
    checks.push(
      notEval("table-content-volume", 1, "table content volume is unknown"),
    );
  }

  return checks;
}

/** Raster conversions (pdf-to-jpg, pdf-to-png): structure and coverage only. */
function rasterConversionChecks(
  input: QualityAssessmentInput,
): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const images = metaNumber(input.meta, "images");
  const pages = metaNumber(input.meta, "pages");

  if (images !== undefined && pages !== undefined) {
    checks.push(
      images === pages
        ? pass(
            "output-page-coverage",
            2,
            `one image was produced for each of the ${pages} source page(s)`,
          )
        : warn(
            "output-page-coverage",
            2,
            `${images} image(s) were produced for ${pages} source page(s)`,
          ),
    );
  } else {
    checks.push(
      notEval("output-page-coverage", 2, "page coverage is unknown"),
    );
  }

  // Deliberately NO text-availability checks: a text-free source is
  // perfectly normal for image export.
  return checks;
}

/** Extract Images: zero images is only suspicious when the source has some. */
function extractImagesChecks(input: QualityAssessmentInput): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const extracted = metaNumber(input.meta, "extractedImagesCount");
  const bearingPages = input.profile?.imageBearingPageCount;

  if (extracted !== undefined) {
    if (extracted > 0) {
      checks.push(
        pass(
          "image-content-volume",
          1,
          `${extracted} embedded image(s) were extracted`,
        ),
      );
    } else if (bearingPages === 0) {
      checks.push(
        pass(
          "image-content-volume",
          1,
          "no images were extracted and the source contains no image objects, which is expected",
        ),
      );
    } else {
      checks.push(
        warn(
          "image-content-volume",
          1,
          "no embedded images were found — the document may contain none",
        ),
      );
    }
  } else {
    checks.push(
      notEval("image-content-volume", 1, "image content volume is unknown"),
    );
  }

  return checks;
}

/** Image → PDF conversions: page coverage against the input file count. */
function imagesToPdfChecks(input: QualityAssessmentInput): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const pages = metaNumber(input.meta, "pages");

  if (pages !== undefined && input.inputFileCount > 0) {
    checks.push(
      pages === input.inputFileCount
        ? pass(
            "output-page-coverage",
            2,
            `one page was produced for each of the ${input.inputFileCount} input image(s)`,
          )
        : warn(
            "output-page-coverage",
            2,
            `${pages} page(s) were produced for ${input.inputFileCount} input image(s)`,
          ),
    );
  } else {
    checks.push(
      notEval("output-page-coverage", 2, "page coverage is unknown"),
    );
  }

  return checks;
}

/**
 * Compress PDF: structural checks only. Size reduction is NOT a quality
 * signal — compression quality cannot be measured from size alone, and the
 * tool already refuses rasterised output that is not smaller.
 */
function compressPdfChecks(): QualityCheck[] {
  return [
    immaterial(
      "compression-fidelity",
      "compression quality cannot be measured from size changes alone",
    ),
  ];
}

/** Compare Documents: structural checks only; no semantic scoring exists. */
function compareDocumentsChecks(): QualityCheck[] {
  return [
    immaterial(
      "semantic-fidelity",
      "document similarity quality is not measured",
    ),
  ];
}

const POLICIES: Record<
  ConversionType,
  (input: QualityAssessmentInput) => QualityCheck[]
> = {
  "pdf-to-word": (input) => textExtractionChecks(input, { contentKey: "characters" }),
  "pdf-to-text": (input) => textExtractionChecks(input, { outputIsText: true }),
  "pdf-to-excel": tableChecks,
  "extract-tables": tableChecks,
  "pdf-to-jpg": rasterConversionChecks,
  "pdf-to-png": rasterConversionChecks,
  "extract-images": extractImagesChecks,
  "images-to-pdf": imagesToPdfChecks,
  "png-to-pdf": imagesToPdfChecks,
  "compress-pdf": compressPdfChecks,
  "compare-documents": compareDocumentsChecks,
};

/**
 * Assess a conversion result. Pure and deterministic: the same input always
 * yields the same assessment. Diagnostic only — callers must not use the
 * verdict to fail, retry or re-route anything (Stage 4, PLANNED, will make
 * that decision explicitly).
 */
export function assessConversionQuality(
  conversionType: ConversionType,
  input: QualityAssessmentInput,
): QualityAssessment {
  const policy = POLICIES[conversionType];
  if (!policy) {
    return {
      qualityVersion: QUALITY_VERSION,
      state: "not-evaluated",
      score: 0,
      checks: [],
    };
  }

  const checks = [...commonChecks(input), ...policy(input)];

  const measurable = checks.filter((check) => check.weight > 0);
  const measurableWeight = measurable.reduce(
    (total, check) => total + check.weight,
    0,
  );
  const evaluated = measurable.filter((check) => check.state !== "not-evaluated");
  const evaluatedWeight = evaluated.reduce(
    (total, check) => total + check.weight,
    0,
  );
  const passWeight = evaluated
    .filter((check) => check.state === "pass")
    .reduce((total, check) => total + check.weight, 0);

  const score =
    evaluatedWeight === 0
      ? 0
      : Math.round((100 * passWeight) / evaluatedWeight);

  let state: QualityState;
  if (
    evaluatedWeight === 0 ||
    (measurableWeight > 0 && evaluatedWeight / measurableWeight < 0.5)
  ) {
    // Less than half of the measurable evidence is available: an honest
    // "cannot tell" rather than a guessed verdict.
    state = "insufficient";
  } else if (checks.some((check) => check.state === "warn")) {
    state = "suspicious";
  } else {
    state = "healthy";
  }

  return { qualityVersion: QUALITY_VERSION, state, score, checks };
}
