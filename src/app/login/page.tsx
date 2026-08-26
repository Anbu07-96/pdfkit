"use client";

import { LogIn, ShieldAlert } from "lucide-react";
import { signIn } from "next-auth/react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export default function LoginPage() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      setError("Please enter both email and password.");
      return;
    }

    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (cleanPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await signIn("credentials", {
        email: cleanEmail,
        password: cleanPassword,
        redirect: false,
        callbackUrl: "/account",
      });

      if (res?.error) {
        setError("Invalid email address or password.");
      } else if (res?.url) {
        window.location.href = res.url;
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container max-w-md py-12">
      <SectionHeader
        title="Sign in to PDFKit"
        description="Sign in to your account to manage your settings and identity."
      />

      <div className="mt-8 rounded-2xl border border-border bg-surface p-6 shadow-xs">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Email address"
            type="email"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            hint="Password must be at least 6 characters."
          />

          {error ? (
            <p className="text-xs text-danger flex items-center gap-1.5" role="alert">
              <ShieldAlert className="size-4 shrink-0" />
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={loading || !email || !password}>
            <LogIn className="size-4" />
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="relative my-6 text-center text-xs text-muted">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <span className="relative bg-surface px-2">Or continue with</span>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            onClick={() => signIn("github", { callbackUrl: "/account" })}
          >
            Sign in with GitHub
          </Button>
          <Button
            variant="secondary"
            onClick={() => signIn("google", { callbackUrl: "/account" })}
          >
            Sign in with Google
          </Button>
        </div>
      </div>
    </main>
  );
}
