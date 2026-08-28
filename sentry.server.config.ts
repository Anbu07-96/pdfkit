import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: Boolean(SENTRY_DSN),
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // Sanitize request data defensively
    if (event.request) {
      delete event.request.data;
      delete event.request.cookies;
      if (event.request.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
    }
    return event;
  },
});
