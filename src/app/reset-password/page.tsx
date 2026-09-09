"use client";

import { ShieldAlert, CheckCircle2, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";

/**
 * Phase 66 — password-reset confirmation page.
 *
 * The one-time token arrives via the emailed link's ?token=… query parameter.
 * The token is sent ONLY to the reset-confirm API — never logged, never
 * stored client-side beyond the URL.
 */
export default function ResetPasswordPage() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match. Please re-enter your password.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = (await res.json().catch(() => null)) as {
        message?: string;
        error?: { message?: string };
      } | null;
      if (res.ok) {
        setDone(true);
      } else {
        setError(body?.error?.message ?? "The reset link is invalid or has expired.");
      }
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center px-4 py-16">
        <div className="w-full max-w-md text-center">
          <ShieldAlert className="mx-auto size-10 text-error" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold text-foreground">
            Reset link required
          </h1>
          <p className="mt-2 text-sm text-muted">
            This page needs a valid one-time reset link from your email.
          </p>
          <Link
            href="/forgot-password"
            className="mt-6 inline-block text-sm font-medium text-brand hover:underline"
          >
            Request a new link
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <SectionHeader
          title="Choose a new password"
          description="Your reset link works once and expires 1 hour after it was requested."
        />

        <div className="mt-6 rounded-2xl border border-border bg-surface p-6 shadow-xs">
          {done ? (
            <div className="flex flex-col gap-4 text-center">
              <CheckCircle2 className="mx-auto size-8 text-success" aria-hidden="true" />
              <p className="text-sm text-foreground" role="status">
                Your password has been updated. Existing sessions were signed
                out for your security.
              </p>
              <Link
                href="/login"
                className="text-sm font-medium text-brand hover:underline"
              >
                Sign in with your new password
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
              <Input
                label="Confirm new password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                required
              />

              {error ? (
                <p className="text-xs text-error flex items-center gap-1.5" role="alert">
                  <ShieldAlert className="size-4 shrink-0" />
                  {error}
                </p>
              ) : null}

              <Button type="submit" size="lg" disabled={loading || !password || !confirmPassword}>
                <LockKeyhole aria-hidden="true" className="size-4" />
                {loading ? "Updating…" : "Set new password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
