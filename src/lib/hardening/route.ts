import "server-only";

import { randomUUID } from "node:crypto";
import {
  handleProcessingRequest as handleProcessingRequestCore,
  jsonError,
  methodNotAllowed,
  type HandleProcessingRequestOptions,
} from "@/lib/processing/http";
import { getHardeningConfig } from "@/lib/hardening/config";
import {
  checkContentLengthHeader,
} from "@/lib/hardening/guards";
import {
  checkRateLimit,
  releaseDistributedSlot,
  tryAcquireDistributedSlot,
} from "@/lib/hardening/distributed-protection";
import { captureServerException } from "@/lib/monitoring/sentry";
import type { UserIdentity } from "@/lib/auth/types";
import { recordTelemetryEvent } from "@/lib/monitoring/telemetry";
import { getUserIdentity } from "@/lib/auth/session";
import { getUsageService } from "@/lib/usage/service";

/**
 * Hardened processing-route handler (Phase 28, Wave 1).
 *
 * Every `/api/tools/*` route goes through this wrapper instead of calling the
 * HTTP adapter directly. It adds these production guards around the unchanged
 * adapter:
 *
 * 1. the numeric Content-Length gate (reject malformed headers up front);
 * 2. the plan quota preflight gate (before reading the body);
 * 3. the IP rate limit (reject abusive traffic fast with an honest
 *    `Retry-After`);
 * 4. the optional concurrency cap (fail fast with 503, never queue silently);
 * 5. the request timeout (answer 504 after the budget without pretending the
 *    work was aborted — pdfium/pdf-lib jobs cannot be cancelled, so the job
 *    finishes privately and its slot is released when it actually ends).
 *
 * Phase 63 adds a per-request correlation id (`x-pdfkit-request-id` response
 * header, attached to telemetry and job logs) and records one
 * `http_response` telemetry event for every final response — the traffic and
 * status-class metrics come from here, while job-level metrics come from the
 * processing service.
 */

export { methodNotAllowed };

/** Options for {@link withHardenedRequest}. */
export interface HardenedRequestOptions {
  /**
   * Endpoint label used for guard telemetry (`http_response`,
   * `quota_rejected`, `server_busy`, `request_timeout`). Tool routes pass
   * their tool id; shared document endpoints pass their endpoint label.
   */
  toolId: string;
  /** Pre-resolved identity (tests / internal callers); resolved otherwise. */
  identity?: UserIdentity;
}

/** What the protected handler receives. */
export interface HardenedRequestContext {
  identity: UserIdentity;
  requestId: string;
}

export async function handleProcessingRequest<TOptions = Record<string, unknown>>(
  request: Request,
  options: HandleProcessingRequestOptions<TOptions>,
): Promise<Response> {
  // Phase 75B: the guard sequence lives in the shared wrapper below so the
  // document endpoints (inspect / thumbnails) run through the IDENTICAL
  // protection. Tool-route behaviour here is unchanged.
  return withHardenedRequest(
    request,
    { toolId: options.toolId, identity: options.identity },
    ({ identity, requestId }) =>
      handleProcessingRequestCore<TOptions>(request, { ...options, identity, requestId }),
  );
}

/**
 * Run an arbitrary request handler behind the full production hardening
 * sequence (Phase 28/41/43/63; extracted in Phase 75B so the shared
 * document endpoints get the same protection as tool routes with ONE
 * implementation, not a second one):
 *
 * 1. numeric Content-Length gate; 2. identity resolution; 3. plan quota
 * preflight (a CHECK only — usage is recorded by the tool flow, never
 * here, so nothing is double-counted); 4. IP rate limit; 5. concurrency
 * slot (fail fast 503, no queue); 6. request watchdog (504; the job is
 * never aborted — the slot is released exactly once, when the real work
 * ends). Every final response carries `x-pdfkit-request-id` and records
 * one `http_response` telemetry event.
 */
export async function withHardenedRequest(
  request: Request,
  options: HardenedRequestOptions,
  handler: (context: HardenedRequestContext) => Promise<Response>,
): Promise<Response> {
  const startedAt = Date.now();
  // Correlation id for logs/telemetry. Server-generated, carried in the
  // response header so a user reporting a problem can quote it.
  const requestId = `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const response = await runGuardedRequest(request, options, handler, requestId);

  response.headers.set("x-pdfkit-request-id", requestId);
  recordTelemetryEvent({
    type: "http_response",
    toolId: options.toolId,
    requestId,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });
  return response;
}

async function runGuardedRequest(
  request: Request,
  options: HardenedRequestOptions,
  handler: (context: HardenedRequestContext) => Promise<Response>,
  requestId: string,
): Promise<Response> {
  const config = getHardeningConfig();

  // 1. Content-Length gate — before the body is even looked at.
  const contentLengthProblem = checkContentLengthHeader(request);
  if (contentLengthProblem) return contentLengthProblem;

  // 2. Identity resolution (Phase 42)
  const identity = options.identity || (await getUserIdentity());

  // 3. Plan Quota Preflight Gate (Phase 43) — before reading body or acquiring slot
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  const requestedBytes =
    Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : undefined;

  const preflight = await getUsageService().evaluatePreflight(identity, requestedBytes);

  if (!preflight.allowed) {
    // Operational telemetry (Phase 62/63): which guard fired and for which
    // tier. No user-identifying data — the quota service owns identity.
    recordTelemetryEvent({
      type: "quota_rejected",
      toolId: options.toolId,
      tier: preflight.tier ?? "other",
      reason: preflight.reason ?? "unknown",
      ...(requestedBytes !== undefined ? { requestedBytes } : {}),
    });

    if (preflight.reason === "SERVICE_UNAVAILABLE") {
      return jsonError(
        "USAGE_SERVICE_UNAVAILABLE",
        preflight.message ||
          "Usage tracking service is temporarily unavailable. Please try again later.",
      );
    }
    return jsonError(
      "QUOTA_EXCEEDED",
      preflight.message || "Daily plan processing quota exceeded.",
    );
  }

  // 4. IP Rate limit check — reject abusive traffic fast with 429
  const rateLimitProblem = await checkRateLimit(request, config.rateLimitPerMinute);
  if (rateLimitProblem) return rateLimitProblem;

  // 5. Concurrency cap — fail fast so overloads are visible to the caller (503 SERVER_BUSY).
  const acquired = await tryAcquireDistributedSlot(config.maxConcurrentJobs);
  if (!acquired) {
    recordTelemetryEvent({ type: "server_busy", toolId: options.toolId });
    return jsonError(
      "SERVER_BUSY",
      "The server is processing other documents right now. Please try again in a moment.",
    );
  }

  // 6. Run the adapter with the request timeout around it.
  //
  // Three promises, one invariant: the slot is released exactly once, when the
  // real job ends — never when the timeout fires.
  let timer: ReturnType<typeof setTimeout> | undefined;

  const job: Promise<Response> = Promise.resolve()
    .then(() => handler({ identity, requestId }))
    .catch((error: unknown) => {
      // The adapter converts every expected failure already; this protects the
      // race below from an unexpected throw (and from an unhandled rejection
      // when the timeout response has long been sent).
      console.error("[hardening] unexpected failure in a processing route", error);
      captureServerException(error, { toolId: options.toolId });
      return jsonError(
        "INTERNAL_ERROR",
        "Something went wrong while processing your files. Please try again.",
      );
    })
    .finally(() => {
      void releaseDistributedSlot();
    });

  const timeout: Promise<Response> = new Promise((resolve) => {
    timer = setTimeout(() => {
      // Operational telemetry (Phase 62/63): the caller gave up; the job keeps
      // running privately and still logs its own outcome when it ends.
      recordTelemetryEvent({
        type: "request_timeout",
        toolId: options.toolId,
        requestId,
        timeoutMs: config.requestTimeoutMs,
      });
      resolve(
        jsonError(
          "REQUEST_TIMEOUT",
          "Processing took too long and was stopped. Try a smaller file or fewer pages, then try again.",
        ),
      );
    }, config.requestTimeoutMs);
    // The watchdog must never keep the Node process alive on its own.
    timer.unref?.();
  });

  const response = await Promise.race([job, timeout]);
  if (timer) clearTimeout(timer);

  return response;
}
