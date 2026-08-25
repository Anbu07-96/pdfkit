"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface UpgradeButtonProps {
  currentTier: string;
}

export function UpgradeButton({ currentTier }: UpgradeButtonProps) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (currentTier === "pro" || currentTier === "business") {
    return (
      <div className="rounded-xl border border-border bg-surface-hover/30 p-4">
        <div className="text-xs font-semibold text-success uppercase tracking-wider">
          Active Subscription
        </div>
        <p className="mt-1 text-xs text-muted">
          Your account is on the higher-tier {currentTier.toUpperCase()} plan with expanded quotas.
        </p>
      </div>
    );
  }

  const handleUpgrade = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: "pro" }),
      });

      const data = (await res.json()) as {
        url?: string;
        error?: { message?: string };
      };

      if (!res.ok || !data.url) {
        setErrorMessage(
          data.error?.message ||
            "Billing checkout is currently unavailable. PDFKit remains fully usable under free quotas.",
        );
        setLoading(false);
        return;
      }

      window.location.href = data.url;
    } catch {
      setErrorMessage(
        "Could not connect to checkout service. Please try again or continue using free quotas.",
      );
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-brand/20 bg-brand-subtle/20 p-4">
        <div>
          <div className="text-sm font-semibold text-foreground">
            PDFKit Pro Plan Available
          </div>
          <p className="text-xs text-muted mt-0.5">
            Upgrade for 500 jobs/day and 2 GB daily volume. Anonymous and Free access remain available.
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={handleUpgrade}
          disabled={loading}
        >
          {loading ? "Redirecting..." : "Upgrade to Pro"}
        </Button>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-lg border border-error/20 bg-error-subtle/20 p-3 text-xs text-error"
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}
