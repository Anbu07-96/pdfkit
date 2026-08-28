"use client";

import { UserPlus, ShieldAlert, CheckCircle2 } from "lucide-react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/section-header";
import { siteConfig } from "@/lib/config/site";

export default function RegisterPage() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }

    if (cleanPassword !== confirmPassword) {
      setError("Passwords do not match. Please re-enter your password.");
      return;
    }

    if (cleanPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await signIn("credentials", {
        email: cleanEmail,
        password: cleanPassword,
        redirect: false,
        callbackUrl: "/account",
      });

      if (res?.error) {
        setError("Could not create account with these credentials. Ensure your email is a non-disposable address and password contains letters and numbers.");
      } else if (res?.url) {
        setSuccess("Account created successfully. Redirecting to your account dashboard...");
        setTimeout(() => {
          window.location.href = res.url!;
        }, 1000);
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
        title={`Create your ${siteConfig.name} Account`}
        description="Register for expanded daily PDF processing quotas."
      />

      <div className="mt-8 rounded-2xl border border-border bg-surface p-6 shadow-xs space-y-6">
        {/* OAuth Fast Sign Up */}
        <div className="flex flex-col gap-3">
          <Button
            variant="secondary"
            size="lg"
            className="w-full justify-center font-medium"
            onClick={() => signIn("google", { callbackUrl: "/account" })}
          >
            <svg className="mr-2 size-4 shrink-0" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            Sign up with Google
          </Button>

          <Button
            variant="secondary"
            size="lg"
            className="w-full justify-center font-medium"
            onClick={() => signIn("azure-ad", { callbackUrl: "/account" })}
          >
            <svg className="mr-2 size-4 shrink-0" viewBox="0 0 23 23">
              <path fill="#f35325" d="M1 1h10v10H1z" />
              <path fill="#81bc06" d="M12 1h10v10H12z" />
              <path fill="#05a6f0" d="M1 12h10v10H1z" />
              <path fill="#ffba08" d="M12 12h10v10H12z" />
            </svg>
            Sign up with Microsoft
          </Button>
        </div>

        <div className="relative my-4 text-center text-xs text-muted">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <span className="relative bg-surface px-2">Or register with email</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Email address"
            type="email"
            placeholder="user@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            hint="Non-disposable, valid email required."
            suppressHydrationWarning
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            hint="8+ characters with letters and numbers."
            suppressHydrationWarning
          />

          <Input
            label="Confirm password"
            type="password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            suppressHydrationWarning
          />

          {error ? (
            <p className="text-xs text-error flex items-center gap-1.5" role="alert">
              <ShieldAlert className="size-4 shrink-0" />
              {error}
            </p>
          ) : null}

          {success ? (
            <p className="text-xs text-success flex items-center gap-1.5" role="status">
              <CheckCircle2 className="size-4 shrink-0" />
              {success}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={loading || !email || !password || !confirmPassword}>
            <UserPlus className="size-4" />
            {loading ? "Creating account…" : "Create Account"}
          </Button>
        </form>

        <div className="pt-2 text-center text-xs text-muted border-t border-border">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
