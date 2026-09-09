"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Phase 66 — cancel the Razorpay subscription at the end of the current paid
 * period. Access (and tier) continue until the period completes; the
 * subscription.completed webhook then downgrades the account to Free.
 */
export function CancelSubscriptionButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  async function handleCancel() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      if (res.ok) {
        setCancelled(true);
        setConfirming(false);
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(body?.error?.message ?? "Cancellation failed. Please try again.");
      }
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (cancelled) {
    return (
      <p className="text-xs text-success" role="status">
        Cancellation scheduled — your Pro access continues until the end of the
        period you already paid for.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
          <p className="text-xs text-muted">
            Cancel at the end of the current paid period? You keep Pro access
            until then; afterwards your account returns to the Free plan. No
            further charges are made.
          </p>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={handleCancel} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CalendarOff aria-hidden="true" className="size-4" />}
              {loading ? "Cancelling…" : "Confirm cancellation"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={loading}>
              Keep subscription
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          Cancel subscription
        </Button>
      )}
      {error ? (
        <p className="text-xs text-error flex items-center gap-1.5" role="alert">
          <ShieldAlert className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
