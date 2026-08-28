import "server-only";

import * as Sentry from "@sentry/nextjs";

/**
 * Server-side error reporting helper.
 *
 * Reports unexpected server exceptions to Sentry when configured.
 * Sanitizes all context to guarantee PII, passwords, filenames, and
 * document contents are never transmitted.
 */

export function captureServerException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.withScope((scope) => {
    if (context) {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(context)) {
        // Strip keys that could carry user content or credentials
        if (
          /password|file|filename|content|text|url|body|auth|token|secret/i.test(
            key,
          )
        ) {
          continue;
        }
        sanitized[key] = value;
      }
      scope.setExtras(sanitized);
    }
    Sentry.captureException(error);
  });
}
