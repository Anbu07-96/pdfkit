/**
 * Safe, user-friendly error categories for bulk processing (Phase 62).
 *
 * Server error codes are machine-readable but not user-facing; this module
 * maps every known code onto a small set of categories with honest wording.
 * Nothing here ever exposes stack traces, internal paths, database or Redis
 * errors, or server configuration — the messages are static and the dynamic
 * part (the server's own safe message) is only shown alongside, never
 * replaced by internals.
 *
 * Pure module: no React, no server-only imports, unit-testable everywhere.
 */

export type BulkErrorCategory =
  | "invalid-file"
  | "unsupported-format"
  | "file-too-large"
  | "batch-limit"
  | "daily-quota"
  | "rate-limited"
  | "server-busy"
  | "timeout"
  | "processing-failed"
  | "network"
  | "cancelled"
  | "unknown";

export interface BulkErrorClassification {
  category: BulkErrorCategory;
  /** Short, human-readable label for the UI. */
  label: string;
  /** Safe explanation the user can act on. */
  description: string;
  /**
   * Whether retrying this file is reasonable *right now*. Permanent
   * validation problems (invalid PDF, wrong password, unsupported format)
   * are not retryable — the file must be fixed or replaced first. Quota and
   * batch-budget stops are not immediately retryable either.
   */
  retryable: boolean;
  /** One-line hint shown next to the retry button. */
  retryHint?: string;
}

interface CategoryProfile extends BulkErrorClassification {
  codes: readonly string[];
}

const PROFILES: Record<Exclude<BulkErrorCategory, "unknown">, CategoryProfile> = {
  "invalid-file": {
    category: "invalid-file",
    label: "Invalid file",
    description:
      "This file could not be read as a valid document. It may be corrupted, password-protected or not the format its name suggests.",
    retryable: false,
    retryHint: "Fix or replace the file, then retry.",
    codes: [
      "INVALID_PDF",
      "INVALID_IMAGE",
      "ENCRYPTED_PDF",
      "PDF_NOT_ENCRYPTED",
      "WRONG_PASSWORD",
      "UNSUPPORTED_ENCRYPTION",
      "SIGNED_PDF",
    ],
  },
  "unsupported-format": {
    category: "unsupported-format",
    label: "Unsupported format",
    description:
      "This file type is not supported by this operation. Check the accepted formats shown in the upload area.",
    retryable: false,
    retryHint: "Convert the file to a supported format first.",
    codes: ["UNSUPPORTED_FILE"],
  },
  "file-too-large": {
    category: "file-too-large",
    label: "File too large",
    description:
      "This file is larger than the per-file size limit. Split it or compress it before trying again.",
    retryable: false,
    retryHint: "Use a smaller file.",
    codes: ["FILE_TOO_LARGE"],
  },
  "batch-limit": {
    category: "batch-limit",
    label: "Batch limit reached",
    description:
      "A batch limit (file count, upload size, output size, page or image budget) was reached before this file could run.",
    retryable: false,
    retryHint: "Run the remaining files in a new batch.",
    codes: [
      "TOO_MANY_FILES",
      "TOTAL_SIZE_EXCEEDED",
      "TOO_MANY_OUTPUTS",
      "OUTPUT_TOO_LARGE",
    ],
  },
  "daily-quota": {
    category: "daily-quota",
    label: "Daily quota reached",
    description:
      "The daily processing quota for your plan is used up. The quota resets every day.",
    retryable: false,
    retryHint: "Retry after the quota resets, or upgrade your plan.",
    codes: ["QUOTA_EXCEEDED"],
  },
  "rate-limited": {
    category: "rate-limited",
    label: "Rate limited",
    description:
      "Too many requests were sent in a short time. The batch backed off but this file still could not be processed.",
    retryable: true,
    retryHint: "Safe to retry in a moment.",
    codes: ["TOO_MANY_REQUESTS"],
  },
  "server-busy": {
    category: "server-busy",
    label: "Server busy",
    description:
      "The server was processing other documents and could not take this file after several attempts.",
    retryable: true,
    retryHint: "Safe to retry when the server is quieter.",
    codes: ["SERVER_BUSY"],
  },
  timeout: {
    category: "timeout",
    label: "Processing timeout",
    description:
      "This file took too long to process. Very large or complex documents can exceed the time budget.",
    retryable: true,
    retryHint: "Try again, or split the document first.",
    codes: ["REQUEST_TIMEOUT"],
  },
  "processing-failed": {
    category: "processing-failed",
    label: "Processing failed",
    description:
      "The server could not process this file. The file itself may use features this operation does not support.",
    retryable: false,
    retryHint: "Try a different file, or use the single-file tool for options.",
    codes: [
      "PROCESSING_ERROR",
      "VALIDATION_ERROR",
      "INVALID_SPLIT_CONFIGURATION",
      "INVALID_PAGE_RANGE",
      "PAGE_OUT_OF_RANGE",
      "OVERLAPPING_RANGES",
      "INVALID_PAGE_ORDER",
      "INVALID_PAGE_ROTATION",
      "INVALID_WATERMARK_CONFIGURATION",
      "INVALID_PAGE_NUMBER_CONFIGURATION",
      "INVALID_CROP_CONFIGURATION",
      "INVALID_TEXT_CONFIGURATION",
      "INVALID_SHAPE_CONFIGURATION",
      "INVALID_HIGHLIGHT_CONFIGURATION",
      "INVALID_DRAW_CONFIGURATION",
      "INVALID_ANNOTATION_CONFIGURATION",
      "NO_PAGES_REMAIN",
      "TOOL_NOT_AVAILABLE",
      "USAGE_SERVICE_UNAVAILABLE",
    ],
  },
  network: {
    category: "network",
    label: "Network error",
    description:
      "The file could not be sent. Check your connection — the batch pauses automatically while you are offline.",
    retryable: true,
    retryHint: "Safe to retry once you are back online.",
    codes: ["NETWORK_ERROR"],
  },
  cancelled: {
    category: "cancelled",
    label: "Cancelled",
    description: "Processing was cancelled before this file finished.",
    retryable: true,
    retryHint: "Safe to retry.",
    codes: [],
  },
};

const CODE_TO_CATEGORY = new Map<string, BulkErrorCategory>(
  (Object.values(PROFILES) as CategoryProfile[]).flatMap((profile) =>
    profile.codes.map((code) => [code, profile.category] as const),
  ),
);

/**
 * Classify an error code (or a client-side network failure) into a safe,
 * user-friendly category. Unknown codes map to `unknown` with honest wording
 * rather than leaking internals.
 */
export function classifyBulkError(code?: string): BulkErrorClassification {
  if (code && CODE_TO_CATEGORY.has(code)) {
    const profile = PROFILES[CODE_TO_CATEGORY.get(code)! as Exclude<BulkErrorCategory, "unknown">];
    return {
      category: profile.category,
      label: profile.label,
      description: profile.description,
      retryable: profile.retryable,
      ...(profile.retryHint ? { retryHint: profile.retryHint } : {}),
    };
  }
  return {
    category: "unknown",
    label: "Unknown error",
    description:
      "Something went wrong that could not be categorised. You can retry the file; if it keeps failing, try the single-file tool.",
    retryable: true,
    retryHint: "Safe to retry once.",
  };
}

/** Classification for a file the user cancelled (not an error code). */
export function cancelledClassification(): BulkErrorClassification {
  const profile = PROFILES.cancelled;
  return {
    category: profile.category,
    label: profile.label,
    description: profile.description,
    retryable: profile.retryable,
    retryHint: profile.retryHint,
  };
}
