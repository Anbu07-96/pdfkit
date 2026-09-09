import "server-only";

/**
 * Phase 66 — provider-neutral transactional email transport.
 *
 * The transport is SMTP (works with any provider: SES, Postmark, Resend,
 * SendGrid, Zoho, Gmail workspace, self-hosted). nodemailer is pure
 * JavaScript — no native binaries, consistent with the architecture.
 *
 * Configuration (names only, never logged values):
 *   SMTP_HOST       — required to enable real delivery
 *   SMTP_PORT       — default 587
 *   SMTP_SECURE     — "true" for implicit TLS (port 465)
 *   SMTP_USER       — username (optional, depending on provider)
 *   SMTP_PASS       — password or API key (secret)
 *   SMTP_FROM       — verified sender address, e.g. "PDFKit <no-reply@…>"
 *
 * Behavior:
 *   - SMTP_HOST unset:
 *       development/test → the message is NOT sent; the caller receives
 *       { delivered: false, reason: "smtp-not-configured" } and decides how
 *       to surface it (verification logs a one-time link; password reset
 *       must NOT log tokens — it surfaces a clear failure in production).
 *       production      → throws: failing loudly beats silently losing mail.
 *   - SMTP_HOST set: real delivery through nodemailer. Failures throw so
 *     callers can distinguish "sent" from "not sent" honestly.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  delivered: boolean;
  reason?: "smtp-not-configured";
}

class EmailTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailTransportError";
  }
}

export function isEmailTransportError(error: unknown): error is EmailTransportError {
  return error instanceof EmailTransportError;
}

function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

/**
 * Send a transactional email. Throws on transport failure and on missing
 * production configuration; returns { delivered: false } only in the
 * non-production no-SMTP case.
 */
export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  if (!isSmtpConfigured()) {
    if (process.env.NODE_ENV === "production") {
      // Fail clearly: production must never pretend mail was sent.
      throw new EmailTransportError(
        "[email] SMTP_HOST is not configured — transactional email cannot be sent in production.",
      );
    }
    // Development/test: honest "not delivered" signal. The caller decides
    // what to do (e.g. verification links are logged for local testing).
    return { delivered: false, reason: "smtp-not-configured" };
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "no-reply@localhost",
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    return { delivered: true };
  } catch (error) {
    // Never log the message body, recipient address or credentials — only
    // the transport error class itself.
    const detail = error instanceof Error ? error.message.split("\n")[0] : "unknown";
    throw new EmailTransportError(`[email] SMTP delivery failed: ${detail.slice(0, 120)}`);
  }
}

/** Whether real email delivery is enabled on this deployment. */
export function isEmailDeliveryEnabled(): boolean {
  return isSmtpConfigured();
}
