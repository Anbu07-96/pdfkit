import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { UserIdentity } from "@/lib/auth/types";
import { getBillingConfig } from "@/lib/billing/config";
import { PLANS, getPlan, formatInr, ANONYMOUS_LIMITS } from "@/lib/billing/plans";
import { BillingService } from "@/lib/billing/service";
import { ProcessingError } from "@/lib/processing/errors";
import { DEFAULT_TIER_QUOTAS } from "@/lib/usage/config";
import { BULK_BATCH_CEILINGS } from "@/lib/tools/bulk";
import { TOOLS } from "@/lib/tools/catalog";
import {
  InMemoryUsageRepository,
  setUsageRepositoryOverride,
} from "@/lib/usage/repository";

/**
 * Phase 66 — commercial readiness tests: plan catalog consistency, billing
 * operating modes, entitlement-source-of-truth hardening (subscription
 * ownership binding), and truthful cancellation semantics.
 */

const mockUserIdentity: UserIdentity = {
  isAuthenticated: true,
  userId: "usr_phase66_billing",
  email: "phase66@example.com",
  name: "Phase 66",
  status: "active",
  tier: "free",
};

describe("Phase 66 — Plan catalog (single source of truth)", () => {
  it("defines exactly Free, Pro and Business", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["free", "pro", "business"]);
  });

  it("derives daily quotas from the enforced usage config (no drift)", () => {
    for (const plan of PLANS) {
      expect(plan.dailyJobLimit).toBe(DEFAULT_TIER_QUOTAS[plan.id].dailyJobLimit);
      expect(plan.dailyByteLimit).toBe(DEFAULT_TIER_QUOTAS[plan.id].dailyByteLimit);
    }
    expect(ANONYMOUS_LIMITS.dailyJobLimit).toBe(DEFAULT_TIER_QUOTAS.anonymous.dailyJobLimit);
  });

  it("derives bulk allowances from the enforced bulk ceilings (no drift)", () => {
    for (const plan of PLANS) {
      expect(plan.bulkFilesPerBatch).toBe(BULK_BATCH_CEILINGS[plan.id].files);
      expect(plan.bulkInputBytesPerBatch).toBe(BULK_BATCH_CEILINGS[plan.id].inputBytes);
    }
  });

  it("advertises only available tools — the count matches the catalog", () => {
    const available = TOOLS.filter((t) => t.status === "AVAILABLE").length;
    const free = getPlan("free")!;
    // The Free plan feature line mentions every available tool.
    const toolsLine = free.features.find((f) => f.label.includes("available online tools"));
    expect(toolsLine).toBeDefined();
    expect(toolsLine!.label).toContain(String(available));
  });

  it("marks only Pro purchasable; business is contact-sales", () => {
    expect(getPlan("pro")!.purchasable).toBe(true);
    expect(getPlan("pro")!.providerPlanIdEnv).toBe("RAZORPAY_PRO_PLAN_ID");
    expect(getPlan("business")!.purchasable).toBe(false);
    expect(getPlan("business")!.cta?.href).toBe("/contact");
  });

  it("formats INR prices correctly", () => {
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(49900)).toBe("₹499");
    expect(formatInr(249900)).toBe("₹2,499");
  });

  it("does not advertise unimplemented features (priority queue, dedicated support)", () => {
    const allLabels = PLANS.flatMap((p) => p.features.map((f) => f.label.toLowerCase()));
    expect(allLabels.some((l) => l.includes("priority"))).toBe(false);
    expect(allLabels.some((l) => l.includes("dedicated"))).toBe(false);
    for (const plan of PLANS) {
      for (const feature of plan.features) {
        expect(feature.available).toBe(true);
      }
    }
  });
});

describe("Phase 66 — Billing operating modes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats missing variables as disabled", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "");
    expect(getBillingConfig().mode).toBe("disabled");
    expect(getBillingConfig().isConfigured).toBe(false);
  });

  it("detects test keys as test mode", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "secret");
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_1");
    const config = getBillingConfig();
    expect(config.mode).toBe("test");
    expect(config.isConfigured).toBe(true);
  });

  it("keeps live keys DISABLED without the explicit acknowledgment (fail-closed)", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_abc");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "secret");
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_1");
    delete process.env.PDFKIT_BILLING_ALLOW_LIVE;
    const config = getBillingConfig();
    expect(config.mode).toBe("disabled");
    expect(config.isConfigured).toBe(false);
  });

  it("requires BOTH live keys and the acknowledgment for live mode", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_live_abc");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "secret");
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_1");
    vi.stubEnv("PDFKIT_BILLING_ALLOW_LIVE", "true");
    expect(getBillingConfig().mode).toBe("live");
  });

  it("treats unrecognized key formats as disabled", () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "not-a-razorpay-key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "secret");
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_1");
    expect(getBillingConfig().mode).toBe("disabled");
  });
});

describe("Phase 66 — Entitlement hardening (payment verification)", () => {
  let repo: InMemoryUsageRepository;
  let service: BillingService;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
    service = new BillingService(repo);
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_pro_1");
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
    vi.unstubAllEnvs();
  });

  /** Sign a (paymentId, subscriptionId) pair the way Razorpay checkout does. */
  function sign(paymentId: string, subscriptionId: string): string {
    return createHmac("sha256", "rzp_test_secret")
      .update(`${paymentId}|${subscriptionId}`)
      .digest("hex");
  }

  it("rejects a valid signature for a subscription that belongs to a DIFFERENT account", async () => {
    // Victim account with its own checkout-created subscription.
    await repo.upsertUserAccount({
      userId: mockUserIdentity.userId,
      email: mockUserIdentity.email,
      tier: "free",
      razorpaySubscriptionId: "sub_victim_own",
    });
    // Attacker replays a genuine Razorpay signature for someone else's
    // subscription — the signature itself is valid (Razorpay signed it).
    await expect(
      service.verifyPayment({
        identity: mockUserIdentity,
        razorpayPaymentId: "pay_other_user",
        razorpaySubscriptionId: "sub_other_user",
        razorpaySignature: sign("pay_other_user", "sub_other_user"),
      }),
    ).rejects.toThrow(ProcessingError);

    const account = await repo.getUserAccount(mockUserIdentity.userId);
    expect(account?.tier).toBe("free"); // NOT upgraded
  });

  it("rejects a signature when the account has NO stored subscription", async () => {
    await repo.upsertUserAccount({
      userId: mockUserIdentity.userId,
      email: mockUserIdentity.email,
      tier: "free",
    });
    await expect(
      service.verifyPayment({
        identity: mockUserIdentity,
        razorpayPaymentId: "pay_any",
        razorpaySubscriptionId: "sub_any",
        razorpaySignature: sign("pay_any", "sub_any"),
      }),
    ).rejects.toThrow(ProcessingError);
  });

  it("upgrades ONLY when the signature matches the account's own subscription", async () => {
    await repo.upsertUserAccount({
      userId: mockUserIdentity.userId,
      email: mockUserIdentity.email,
      tier: "free",
      razorpaySubscriptionId: "sub_mine",
    });
    const result = await service.verifyPayment({
      identity: mockUserIdentity,
      razorpayPaymentId: "pay_mine",
      razorpaySubscriptionId: "sub_mine",
      razorpaySignature: sign("pay_mine", "sub_mine"),
    });
    expect(result.verified).toBe(true);
    const account = await repo.getUserAccount(mockUserIdentity.userId);
    expect(account?.tier).toBe("pro");
  });
});

describe("Phase 66 — Webhook cancellation semantics", () => {
  let repo: InMemoryUsageRepository;
  let service: BillingService;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
    service = new BillingService(repo);
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_pro_1");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "wh_secret");
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
    vi.unstubAllEnvs();
  });

  function webhookBody(event: string, subscriptionId: string, currentEndSeconds?: number) {
    return JSON.stringify({
      event,
      event_id: `evt_${event}_${subscriptionId}_${Math.random().toString(36).slice(2, 8)}`,
      payload: {
        subscription: {
          entity: {
            id: subscriptionId,
            notes: { userId: "usr_phase66_wh" },
            ...(currentEndSeconds !== undefined ? { current_end: currentEndSeconds } : {}),
          },
        },
      },
    });
  }

  async function deliver(rawBody: string) {
    const signature = createHmac("sha256", "wh_secret").update(rawBody).digest("hex");
    return service.handleWebhookEvent(rawBody, signature);
  }

  it("does NOT downgrade on subscription.cancelled while paid time remains (cycle-end cancel)", async () => {
    await repo.upsertUserAccount({
      userId: "usr_phase66_wh",
      email: "wh66@example.com",
      tier: "pro",
      razorpaySubscriptionId: "sub_cycle_end",
    });
    const future = Math.floor(Date.now() / 1000) + 15 * 24 * 3600; // paid period still running
    await deliver(webhookBody("subscription.cancelled", "sub_cycle_end", future));
    const account = await repo.getUserAccount("usr_phase66_wh");
    expect(account?.tier).toBe("pro"); // keeps the paid period
  });

  it("downgrades on subscription.cancelled when no paid time remains", async () => {
    await repo.upsertUserAccount({
      userId: "usr_phase66_wh",
      email: "wh66@example.com",
      tier: "pro",
      razorpaySubscriptionId: "sub_ended",
    });
    const past = Math.floor(Date.now() / 1000) - 3600;
    await deliver(webhookBody("subscription.cancelled", "sub_ended", past));
    const account = await repo.getUserAccount("usr_phase66_wh");
    expect(account?.tier).toBe("free");
  });

  it("downgrades on subscription.completed regardless of remaining time markers", async () => {
    await repo.upsertUserAccount({
      userId: "usr_phase66_wh",
      email: "wh66@example.com",
      tier: "pro",
      razorpaySubscriptionId: "sub_completed",
    });
    const future = Math.floor(Date.now() / 1000) + 86400; // stale marker — completion wins
    await deliver(webhookBody("subscription.completed", "sub_completed", future));
    const account = await repo.getUserAccount("usr_phase66_wh");
    expect(account?.tier).toBe("free");
  });

  it("downgrades on subscription.halted (charges failing)", async () => {
    await repo.upsertUserAccount({
      userId: "usr_phase66_wh",
      email: "wh66@example.com",
      tier: "pro",
      razorpaySubscriptionId: "sub_halted",
    });
    await deliver(webhookBody("subscription.halted", "sub_halted"));
    const account = await repo.getUserAccount("usr_phase66_wh");
    expect(account?.tier).toBe("free");
  });

  it("still upgrades on subscription.activated and stays idempotent on replays", async () => {
    await repo.upsertUserAccount({
      userId: "usr_phase66_wh",
      email: "wh66@example.com",
      tier: "free",
      razorpaySubscriptionId: "sub_activate",
    });
    const body = webhookBody("subscription.activated", "sub_activate");
    const first = await deliver(body);
    expect(first.status).toBe("success");
    const account = await repo.getUserAccount("usr_phase66_wh");
    expect(account?.tier).toBe("pro");

    const replay = await deliver(body); // same event id → duplicate
    expect(replay.status).toBe("ignored");
    expect(replay.reason).toBe("duplicate");
  });

  it("ignores unknown event types without touching the account", async () => {
    await repo.upsertUserAccount({
      userId: "usr_phase66_wh",
      email: "wh66@example.com",
      tier: "pro",
      razorpaySubscriptionId: "sub_unknown_evt",
    });
    const result = await deliver(webhookBody("refund.processed", "sub_unknown_evt"));
    expect(result.status).toBe("success"); // processed (recorded), no account change
    const account = await repo.getUserAccount("usr_phase66_wh");
    expect(account?.tier).toBe("pro");
  });
});
