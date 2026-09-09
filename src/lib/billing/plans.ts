import "server-only";

import type { UserAccountTier } from "@/lib/auth/types";
import { DEFAULT_TIER_QUOTAS } from "@/lib/usage/config";
import { BULK_BATCH_CEILINGS, BULK_SHARED_BUDGETS } from "@/lib/tools/bulk";
import { TOOLS } from "@/lib/tools/catalog";

/** Count of genuinely available tools (single source: the catalog). */
const AVAILABLE_TOOL_COUNT = TOOLS.filter((t) => t.status === "AVAILABLE").length;

/**
 * Phase 66 — single source of truth for plan (product tier) metadata.
 *
 * Everything user-facing that describes a plan — pricing page, account page,
 * upgrade UI, checkout — reads from here. Usage ceilings are NOT redefined
 * here: they are derived from DEFAULT_TIER_QUOTAS (usage) and
 * BULK_BATCH_CEILINGS (bulk) so this file can never drift from what the
 * server actually enforces. Tests assert the consistency both ways.
 *
 * Billing provider plan IDs are environment-bound (never hardcoded secrets):
 * each purchasable plan declares the env var that holds its provider plan ID.
 */

export type PurchasablePlanId = "pro";

export interface PlanFeature {
  /** Human-readable feature line shown on /pricing. */
  label: string;
  /** Only advertise features that really exist (Phase 66 honesty rule). */
  available: boolean;
}

export interface PlanDefinition {
  id: UserAccountTier;
  /** Display name. */
  name: string;
  /** Monthly price in the smallest currency unit (paise). 0 = free. */
  monthlyPriceMinor: number;
  currency: "INR";
  /** Short marketing line. */
  tagline: string;
  /** Daily job quota — derived from the enforced server config. */
  dailyJobLimit: number;
  /** Daily byte quota (bytes) — derived from the enforced server config. */
  dailyByteLimit: number;
  /** Bulk files per batch — derived from the enforced bulk ceilings. */
  bulkFilesPerBatch: number;
  /** Bulk input bytes per batch — derived from the enforced bulk ceilings. */
  bulkInputBytesPerBatch: number;
  /** Truthful feature list (only implemented behavior). */
  features: PlanFeature[];
  /** Support level wording (honest — no dedicated support infrastructure). */
  supportLevel: string;
  /** Whether this plan can be purchased through the billing provider today. */
  purchasable: boolean;
  /** Env var holding the provider plan ID (purchasable plans only). */
  providerPlanIdEnv?: string;
  /** Non-purchasable plans: where inquiries go. */
  cta?: { label: string; href: string };
}

export const PLANS: readonly PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    monthlyPriceMinor: 0,
    currency: "INR",
    tagline: "For occasional PDF edits and document tasks. No card required.",
    dailyJobLimit: DEFAULT_TIER_QUOTAS.free.dailyJobLimit,
    dailyByteLimit: DEFAULT_TIER_QUOTAS.free.dailyByteLimit,
    bulkFilesPerBatch: BULK_BATCH_CEILINGS.free.files,
    bulkInputBytesPerBatch: BULK_BATCH_CEILINGS.free.inputBytes,
    features: [
      { label: "50 processing jobs per day", available: true },
      { label: "250 MB daily document volume", available: true },
      { label: `All ${AVAILABLE_TOOL_COUNT} available online tools`, available: true },
      { label: "Bulk processing (up to 50 files per batch)", available: true },
      { label: "In-memory processing — files are never stored", available: true },
    ],
    supportLevel: "Community support (email)",
    purchasable: false,
    cta: { label: "Get Started Free", href: "/register" },
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPriceMinor: 49900, // ₹499/month
    currency: "INR",
    tagline: "For power users and professionals with high daily document throughput.",
    dailyJobLimit: DEFAULT_TIER_QUOTAS.pro.dailyJobLimit,
    dailyByteLimit: DEFAULT_TIER_QUOTAS.pro.dailyByteLimit,
    bulkFilesPerBatch: BULK_BATCH_CEILINGS.pro.files,
    bulkInputBytesPerBatch: BULK_BATCH_CEILINGS.pro.inputBytes,
    features: [
      { label: "500 processing jobs per day", available: true },
      { label: "2 GB daily document volume", available: true },
      { label: "Bulk processing (up to 100 files per batch)", available: true },
      { label: "UPI, cards and netbanking via Razorpay", available: true },
      { label: "Cancel anytime — access continues to the end of the paid period", available: true },
    ],
    supportLevel: "Email support",
    purchasable: true,
    providerPlanIdEnv: "RAZORPAY_PRO_PLAN_ID",
  },
  {
    id: "business",
    name: "Business",
    monthlyPriceMinor: 249900, // ₹2,499/month (indicative; sold via contact)
    currency: "INR",
    tagline: "Dedicated volume for teams, organizations and high-frequency workloads.",
    dailyJobLimit: DEFAULT_TIER_QUOTAS.business.dailyJobLimit,
    dailyByteLimit: DEFAULT_TIER_QUOTAS.business.dailyByteLimit,
    bulkFilesPerBatch: BULK_BATCH_CEILINGS.business.files,
    bulkInputBytesPerBatch: BULK_BATCH_CEILINGS.business.inputBytes,
    features: [
      { label: "5,000 processing jobs per day", available: true },
      { label: "20 GB daily document volume", available: true },
      { label: "Bulk processing (up to 100 files per batch)", available: true },
      { label: "Manual invoicing and team onboarding", available: true },
    ],
    supportLevel: "Email support with priority handling",
    purchasable: false, // Contact-sales only until a business plan ID is configured
    cta: { label: "Contact Sales", href: "/contact" },
  },
] as const;

/** Anonymous visitors are not a "plan" in the catalog; their limits are: */
export const ANONYMOUS_LIMITS = {
  name: "Anonymous",
  dailyJobLimit: DEFAULT_TIER_QUOTAS.anonymous.dailyJobLimit,
  dailyByteLimit: DEFAULT_TIER_QUOTAS.anonymous.dailyByteLimit,
  bulkFilesPerBatch: BULK_BATCH_CEILINGS.anonymous.files,
  bulkInputBytesPerBatch: BULK_BATCH_CEILINGS.anonymous.inputBytes,
} as const;

export function getPlan(tier: UserAccountTier): PlanDefinition | null {
  return PLANS.find((p) => p.id === tier) ?? null;
}

/** Shared bulk budgets (identical for every tier — informational). */
export const SHARED_BULK_BUDGETS = BULK_SHARED_BUDGETS;

/** Format a minor-unit INR price for display (e.g. 49900 → "₹499"). */
export function formatInr(minor: number): string {
  if (minor === 0) return "₹0";
  const rupees = Math.floor(minor / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

/** Format a byte count for display (e.g. 2 GB). */
export { formatBytes } from "@/lib/utils/format";
