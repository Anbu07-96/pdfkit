import "server-only";

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
import { getUserIdentity } from "@/lib/auth/session";
import { getUsageService } from "@/lib/usage/service";

/**
 * Hardened processing-route handler (Phase 28, Wave 1).
 *
 * Every `/api/tools/*` route goes through this wrapper instead of calling the
 * HTTP adapter directly. It adds three production guards around the unchanged
 * adapter:
 *
 * 1. the numeric Content-Length gate (reject malformed headers up front);
 * 2. the optional concurrency cap (fail fast with 503, never queue silently);
 * 3. the request timeout (answer 504 after the budget without pretending the
 *    work was aborted — pdfium/pdf-lib jobs cannot be cancelled, so the job
 *    finishes privately and its slot is released when it actually ends).
 *
 * The handler itself stays thin: parsing, validation and delivery all remain
 * in `lib/processing/http.ts`.
 */

export { methodNotAllowed };

export async function handleProcessingRequest<TOptions = Record<string, unknown>>(
  request: Request,
  options: HandleProcessingRequestOptions<TOptions>,
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

  const jobOptions = { ...options, identity };

  const job: Promise<Response> = Promise.resolve()
    .then(() => handleProcessingRequestCore<TOptions>(request, jobOptions))
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
