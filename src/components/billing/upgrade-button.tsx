"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface UpgradeButtonProps {
  currentTier: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
    };
  }
}

export function UpgradeButton({ currentTier }: UpgradeButtonProps) {
  const router = useRouter();
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

  const loadRazorpayScript = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

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
        subscriptionId?: string;
        keyId?: string;
        amount?: number;
        currency?: string;
        planName?: string;
        error?: { message?: string };
      };

      if (!res.ok || !data.subscriptionId || !data.keyId) {
        setErrorMessage(
          data.error?.message ||
            "Razorpay billing is currently unconfigured. PDFKit remains fully usable under free quotas.",
        );
        setLoading(false);
        return;
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        setErrorMessage("Failed to load Razorpay payment SDK. Please check your internet connection.");
        setLoading(false);
        return;
      }

      const options = {
        key: data.keyId,
        subscription_id: data.subscriptionId,
        name: "PDFKit Pro",
        description: "PDFKit Pro Subscription (₹499/mo)",
        currency: data.currency || "INR",
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_subscription_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const verifyRes = await fetch("/api/billing/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySubscriptionId: response.razorpay_subscription_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });

            if (verifyRes.ok) {
              router.push("/account?checkout=success");
            } else {
              setErrorMessage("Payment verification failed. Please contact support.");
              setLoading(false);
            }
          } catch {
            setErrorMessage("Payment verification failed due to network error.");
            setLoading(false);
          }
        },
        theme: {
          color: "#0f172a",
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
      setLoading(false);
    } catch {
      setErrorMessage(
        "Could not connect to billing checkout service. Please try again or continue using free quotas.",
      );
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-brand/20 bg-brand-subtle/20 p-4">
        <div>
          <div className="text-sm font-semibold text-foreground">
            PDFKit Pro Plan (₹499 / $5 mo)
          </div>
          <p className="text-xs text-muted mt-0.5">
            Upgrade with Razorpay for 500 jobs/day and 2 GB daily volume. Anonymous and Free access remain available.
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={handleUpgrade}
          disabled={loading}
        >
          {loading ? "Initializing..." : "Upgrade to Pro"}
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
