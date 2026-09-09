"use client";

import { KeyRound, ShieldAlert, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
import { siteConfig } from "@/lib/config/site";

/**
 * Phase 66 — password-reset request page.
 *
 * The API responds identically for known and unknown addresses (no account
 * enumeration); the confirmation message here mirrors that honesty.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [requested, setRequested] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError("Enter the email address you registered with.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });
      if (res.ok) {
        // The response is generic by design — success/failure of delivery
        // is not distinguishable per address.
        setRequested(true);
      } else if (res.status === 503) {
        // The email system itself is unavailable — say so honestly without
        // revealing anything per-address.
        setError(
          "Password reset is temporarily unavailable. Please try again shortly.",
        );
      } else {
        setError("The request could not be sent. Please try again in a moment.");
      }
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <SectionHeader
          title="Reset your password"
          description={`Request a one-time reset link for your ${siteConfig.name} account.`}
        />

        <div className="mt-6 rounded-2xl border border-border bg-surface p-6 shadow-xs">
          {requested ? (
            <div className="flex flex-col gap-4 text-center">
              <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden="true" />
              <p className="text-sm text-foreground" role="status">
                If an account exists for that address, a reset link is on its
                way. It expires in 1 hour and works once.
              </p>
              <p className="text-xs text-muted">
                For your security we can&apos;t confirm whether the address is
                registered.
              </p>
              <Link
                href="/login"
                className="text-sm font-medium text-brand hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Email address"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />

              {error ? (
                <p className="text-xs text-error flex items-center gap-1.5" role="alert">
                  <ShieldAlert className="size-4 shrink-0" />
                  {error}
                </p>
              ) : null}

              <Button type="submit" size="lg" disabled={loading || !email}>
                <KeyRound aria-hidden="true" className="size-4" />
                {loading ? "Sending…" : "Send reset link"}
              </Button>

              <div className="pt-2 text-center text-xs text-muted">
                Remembered it?{" "}
                <Link href="/login" className="font-semibold text-brand hover:underline">
                  Sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
