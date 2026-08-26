import "server-only";

import Razorpay from "razorpay";
import { getBillingConfig } from "@/lib/billing/config";
import { ProcessingError } from "@/lib/processing/errors";

let razorpayClient: Razorpay | null = null;

/**
 * Get or initialize singleton Razorpay SDK instance.
 */
export function getRazorpayClient(): Razorpay {
  const config = getBillingConfig();

  if (!config.isConfigured || !config.razorpayKeyId || !config.razorpayKeySecret) {
    throw new ProcessingError(
      "VALIDATION_ERROR",
      "Razorpay billing is not configured on this deployment.",
    );
  }

  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: config.razorpayKeyId,
      key_secret: config.razorpayKeySecret,
    });
  }

  return razorpayClient;
}

/**
 * Reset active client instance (primarily used for unit testing).
 */
export function resetRazorpayClient(): void {
  razorpayClient = null;
}
