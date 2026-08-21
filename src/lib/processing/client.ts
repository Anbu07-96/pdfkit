import type { ProcessingErrorCode } from "@/lib/processing/errors";

/**
 * Browser-side client for the processing API.
 *
 * This is the only place the UI knows about HTTP. Components call
 * `runMergePdf()` and receive either a real document or a typed failure — they
 * never build requests, parse responses or touch a PDF library.
 */

export interface ProcessedDocument {
  /** Object URL for the produced document. Revoke it when finished. */
  url: string;
  fileName: string;
  size: number;
  /** Page count reported by the server, when available. */
  pages?: number;
  blob: Blob;
}

export class ProcessingRequestError extends Error {
  readonly code: ProcessingErrorCode | "NETWORK_ERROR";
  readonly details?: string[];

  constructor(
    code: ProcessingErrorCode | "NETWORK_ERROR",
    message: string,
    details?: string[],
  ) {
    super(message);
    this.name = "ProcessingRequestError";
    this.code = code;
    this.details = details?.length ? details : undefined;
  }
}

function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1]?.trim() || fallback;
}

export interface RunMergePdfOptions {
  files: File[];
  signal?: AbortSignal;
}

/**
 * Upload PDFs to the merge endpoint and return the produced document.
 * The order of `files` is the order sent to the server.
 */
export async function runMergePdf({
  files,
  signal,
}: RunMergePdfOptions): Promise<ProcessedDocument> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);

  let response: Response;
  try {
    response = await fetch("/api/tools/merge-pdf", {
      method: "POST",
      body: form,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ProcessingRequestError(
      "NETWORK_ERROR",
      "The files could not be sent. Check your connection and try again.",
    );
  }

  if (!response.ok) {
    let code: ProcessingErrorCode | "NETWORK_ERROR" = "INTERNAL_ERROR";
    let message = "Something went wrong while merging your files.";
    let details: string[] | undefined;

    try {
      const body = (await response.json()) as {
        error?: { code?: ProcessingErrorCode; message?: string; details?: string[] };
      };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
      details = body.error?.details;
    } catch {
      // Non-JSON error body: keep the generic message.
    }

    throw new ProcessingRequestError(code, message, details);
  }

  const blob = await response.blob();
  const pagesHeader = response.headers.get("x-pdfkit-pages");
  const pages = pagesHeader ? Number.parseInt(pagesHeader, 10) : undefined;

  return {
    blob,
    url: URL.createObjectURL(blob),
    fileName: fileNameFromDisposition(
      response.headers.get("content-disposition"),
      "merged.pdf",
    ),
    size: blob.size,
    pages: Number.isFinite(pages) ? pages : undefined,
  };
}
