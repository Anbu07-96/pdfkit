"use client";

import Link from "next/link";
import { Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";

export interface UsageNotificationProps {
  usage?: {
    tier: string;
    jobsUsed: number;
    dailyJobLimit: number;
    jobsRemaining: number;
    bytesUsed: number;
    dailyByteLimit: number;
    bytesRemaining: number;
  };
}

export function UsageNotification({ usage }: UsageNotificationProps) {
  if (!usage) return null;

  const { tier, jobsUsed, dailyJobLimit, jobsRemaining } = usage;
  const isAnon = tier === "anonymous";
  const isPro = tier === "pro" || tier === "business";
  const isNearLimit = jobsRemaining <= Math.ceil(dailyJobLimit * 0.2);
  const isLimitReached = jobsRemaining <= 0;

  if (isLimitReached) {
    return (
      <div className="mt-4 rounded-xl border border-error/30 bg-error-subtle/30 p-4 text-xs text-foreground">
        <div className="flex items-center gap-2 font-semibold text-error">
          <AlertTriangle className="size-4 shrink-0" />
          <span>Daily limit reached ({jobsUsed}/{dailyJobLimit} jobs used today)</span>
        </div>
        <p className="mt-1 text-muted">
          You have reached your daily processing quota. Try again tomorrow or upgrade to Pro for 500 jobs/day.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Link
            href="/pricing"
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Upgrade to Pro
          </Link>
          {isAnon && (
            <Link href="/login" className="text-xs font-medium text-brand hover:underline">
              Sign In
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (isAnon) {
    return (
      <div className="mt-4 rounded-xl border border-brand/20 bg-brand-subtle/20 p-4 text-xs text-foreground">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold text-brand">
            <Sparkles className="size-4 shrink-0" />
            <span>Anonymous usage: {jobsUsed}/{dailyJobLimit} jobs today</span>
          </div>
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Sign In Free
          </Link>
        </div>
        <p className="mt-1 text-muted">
          Sign in for a free account to get 50 jobs/day and 250 MB daily processing volume.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-hover/50 p-3 text-xs text-muted flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-success shrink-0" />
        <span>
          <strong className="font-semibold text-foreground capitalize">{tier} Plan:</strong>{" "}
          {jobsUsed}/{dailyJobLimit} jobs used today ({jobsRemaining} remaining)
        </span>
      </div>
      {!isPro && isNearLimit && (
        <Link href="/pricing" className="font-semibold text-brand hover:underline shrink-0">
          Upgrade
        </Link>
      )}
    </div>
  );
}
