/**
 * Processing boundary (contract only — no implementation exists yet).
 *
 * PDFKit's layering is:
 *
 *   Presentation (app/, components/)
 *        ↓
 *   Application logic (lib/tools, lib/upload)
 *        ↓
 *   API (future: app/api/... route handlers)
 *        ↓
 *   Processing (future: server-side PDF/OCR/AI services)
 *        ↓
 *   Storage (future: temporary object storage)
 *
 * This file exists so the boundary is explicit from day one: when real
 * processing lands, it implements `ToolProcessor` behind an API route and the
 * UI keeps talking to the same shapes. Nothing in `components/` may import a
 * processing implementation directly.
 *
 * Phase 1 intentionally ships ZERO implementations of these types. There is no
 * mock, no stub and no simulated result, because a fake result would mislead
 * users into thinking a tool works.
 */

export interface ProcessingInputFile {
  /** Stable id assigned by the client for this selection. */
  id: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface ProcessingRequest<TOptions = Record<string, unknown>> {
  toolId: string;
  files: ProcessingInputFile[];
  options?: TOptions;
}

export interface ProcessingArtifact {
  name: string;
  mimeType: string;
  size: number;
  /** Short-lived download URL issued by the future storage layer. */
  url: string;
  expiresAt: string;
}

export type ProcessingResult =
  | { status: "succeeded"; artifacts: ProcessingArtifact[] }
  | { status: "failed"; error: { code: string; message: string } };

/**
 * The single interface every future tool implementation will provide.
 * Implementations must run on the server, never in a React component.
 */
export interface ToolProcessor<TOptions = Record<string, unknown>> {
  readonly toolId: string;
  process(request: ProcessingRequest<TOptions>): Promise<ProcessingResult>;
}
