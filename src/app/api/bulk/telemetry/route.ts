import "server-only";

import { checkRateLimit } from "@/lib/hardening/distributed-protection";
import { checkRequestOrigin } from "@/lib/hardening/guards";
import { getHardeningConfig } from "@/lib/hardening/config";
import { BATCH_ID_PATTERN } from "@/lib/processing/http";
import { getBulkOperation } from "@/lib/tools/bulk";
import { recordTelemetryEvent } from "@/lib/monitoring/telemetry";
import {
  BATCH_LIFECYCLE_EVENT_TYPES,
  type BatchLifecycleEventType,
} from "@/lib/monitoring/telemetry-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/bulk/telemetry` — bulk batch lifecycle beacon (Phase 63).
 *
 * Bulk batches are client-orchestrated (Phase 61 architecture, unchanged):
 * the browser knows when a batch starts, finishes, is cancelled or hits a
 * budget; the server only sees per-file jobs. This endpoint lets the browser
 * report those batch-level transitions so batch metrics exist at all.
 *
 * TRUST MODEL — client values are UNTRUSTED:
 * - every field is strictly validated (known operation, strict batch-id
 *   pattern, known event enum, clamped counts); anything else is a 400;
 * - values are recorded as client-reported aggregates only — never used for
 *   authorization, quota or security decisions;
 * - the payload is tiny and counted (≤2 KB), never stored raw;
 * - origin-checked (CSRF guard) and rate-limited under its own scope so it
 *   neither consumes the processing budget nor can be spammed cheaply.
 *
 * The response is always 204 with no body — there is nothing to read back,
 * and the client treats the beacon as fire-and-forget.
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const MAX_BODY_BYTES = 2_048;

interface BeaconBody {
  event?: unknown;
  operation?: unknown;
  batchId?: unknown;
  fileCount?: unknown;
  succeeded?: unknown;
  failed?: unknown;
  skipped?: unknown;
  cancelled?: unknown;
  elapsedMs?: unknown;
  settledFiles?: unknown;
  totalFiles?: unknown;
  reason?: unknown;
}

function badRequest(message: string): Response {
  return Response.json(
    { error: { code: "VALIDATION_ERROR", message } },
    { status: 400, headers: JSON_HEADERS },
  );
}

const MAX_COUNT = 10_000; // files per batch ceiling is 100
const MAX_DURATION_MS = 86_400_000; // 24 h

function isBounded(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
}

function optionalField(value: unknown, max: number): number | undefined {
  return value === undefined ? undefined : isBounded(value, max) ? Math.floor(value) : NaN;
}

export async function POST(request: Request): Promise<Response> {
  const originProblem = checkRequestOrigin(request);
  if (originProblem) return originProblem;

  // Own scope: a batch's handful of beacons must never eat into the shared
  // per-IP processing budget.
  const rateLimitProblem = await checkRateLimit(
    request,
    getHardeningConfig().rateLimitPerMinute,
    "bulk-telemetry",
  );
  if (rateLimitProblem) return rateLimitProblem;

  const raw = await request.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    return badRequest("The telemetry payload is missing or too large.");
  }

  let parsed: BeaconBody;
  try {
    parsed = JSON.parse(raw) as BeaconBody;
  } catch {
    return badRequest("The telemetry payload is not valid JSON.");
  }

  const eventType = parsed.event;
  if (typeof eventType !== "string" || !BATCH_LIFECYCLE_EVENT_TYPES.includes(eventType as BatchLifecycleEventType)) {
    return badRequest("Unknown telemetry event.");
  }

  const operationId = parsed.operation;
  if (typeof operationId !== "string" || !getBulkOperation(operationId)) {
    return badRequest("Unknown bulk operation.");
  }

  const batchId = parsed.batchId;
  if (typeof batchId !== "string" || !BATCH_ID_PATTERN.test(batchId)) {
    return badRequest("Invalid batch id.");
  }

  const fileCount = optionalField(parsed.fileCount, MAX_COUNT);
  const succeeded = optionalField(parsed.succeeded, MAX_COUNT);
  const failed = optionalField(parsed.failed, MAX_COUNT);
  const skipped = optionalField(parsed.skipped, MAX_COUNT);
  const cancelled = optionalField(parsed.cancelled, MAX_COUNT);
  const elapsedMs = optionalField(parsed.elapsedMs, MAX_DURATION_MS);
  const settledFiles = optionalField(parsed.settledFiles, MAX_COUNT);
  const totalFiles = optionalField(parsed.totalFiles, MAX_COUNT);
  const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 32) : undefined;

  const counts = [fileCount, succeeded, failed, skipped, cancelled, elapsedMs, settledFiles, totalFiles];
  if (counts.some((value) => Number.isNaN(value))) {
    return badRequest("Invalid counts in the telemetry payload.");
  }

  switch (eventType) {
    case "batch_started":
      if (fileCount === undefined) return badRequest("fileCount is required.");
      recordTelemetryEvent({ type: "batch_started", batchId, operation: operationId, fileCount });
      break;
    case "batch_completed":
      if (
        fileCount === undefined ||
        succeeded === undefined ||
        failed === undefined ||
        skipped === undefined ||
        cancelled === undefined ||
        elapsedMs === undefined
      ) {
        return badRequest("batch_completed requires all counts.");
      }
      recordTelemetryEvent({
        type: "batch_completed",
        batchId,
        operation: operationId,
        fileCount,
        succeeded,
        failed,
        skipped,
        cancelled,
        elapsedMs,
      });
      break;
    case "batch_cancelled":
    case "batch_quota_stopped":
      if (settledFiles === undefined || totalFiles === undefined) {
        return badRequest("settledFiles and totalFiles are required.");
      }
      recordTelemetryEvent({
        type: eventType,
        batchId,
        operation: operationId,
        settledFiles,
        totalFiles,
      });
      break;
    case "batch_budget_stopped":
      if (settledFiles === undefined || totalFiles === undefined) {
        return badRequest("settledFiles and totalFiles are required.");
      }
      if (!reason || !/^[a-z-]{1,32}$/.test(reason)) {
        return badRequest("Invalid budget stop reason.");
      }
      recordTelemetryEvent({
        type: "batch_budget_stopped",
        batchId,
        operation: operationId,
        reason,
        settledFiles,
        totalFiles,
      });
      break;
  }

  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

export function GET(): Response {
  return Response.json(
    { error: { code: "VALIDATION_ERROR", message: "Use POST." } },
    { status: 405, headers: JSON_HEADERS },
  );
}
