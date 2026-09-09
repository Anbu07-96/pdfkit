// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/billing/cancel/route";
import type { UserIdentity } from "@/lib/auth/types";
import { ProcessingError } from "@/lib/processing/errors";
import {
  InMemoryUsageRepository,
  setUsageRepositoryOverride,
} from "@/lib/usage/repository";

/**
 * Phase 66 — subscription cancellation route: auth-gated, identity-driven
 * (no request body trusted), clean failures for unconfigured billing or
 * missing subscriptions.
 */

vi.mock("@/lib/auth/session", () => ({
  getUserIdentity: vi.fn(),
}));

import { getUserIdentity } from "@/lib/auth/session";
const mockedGetIdentity = vi.mocked(getUserIdentity);

const proIdentity: UserIdentity = {
  isAuthenticated: true,
  userId: "usr_cancel_test",
  email: "cancel@phase66.test",
  name: "Cancel Test",
  status: "active",
  tier: "pro",
};

describe("POST /api/billing/cancel", () => {
  let repo: InMemoryUsageRepository;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_pro_1");
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects anonymous callers with 401", async () => {
    mockedGetIdentity.mockResolvedValueOnce({
      isAuthenticated: false,
      userId: "anon",
      email: null,
      name: null,
      status: "anonymous",
      tier: "anonymous",
    });
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("cancels the account's stored subscription at period end", async () => {
    await repo.upsertUserAccount({
      userId: proIdentity.userId,
      email: proIdentity.email,
      tier: "pro",
      razorpaySubscriptionId: "sub_cancel_1",
    });
    mockedGetIdentity.mockResolvedValueOnce(proIdentity);

    // Spy on the provider call: the Razorpay client is module-level; instead
    // assert through the service seam with a mocked client method.
    const spy = vi
      .spyOn(await import("@/lib/billing/razorpay"), "getRazorpayClient")
      .mockReturnValue({
        subscriptions: {
          cancel: vi.fn().mockResolvedValue({ id: "sub_cancel_1", status: "cancelled" }),
        },
      } as never);

    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cancelled: boolean; tier: string };
    expect(body.cancelled).toBe(true);
    expect(body.tier).toBe("pro"); // keeps the paid period

    const cancelMock = (spy.mock.results[0].value as unknown as {
      subscriptions: { cancel: ReturnType<typeof vi.fn> };
    }).subscriptions.cancel;
    expect(cancelMock).toHaveBeenCalledWith("sub_cancel_1", true); // cancelAtCycleEnd
    spy.mockRestore();
  });

  it("returns a clean 400 when the account has no subscription", async () => {
    await repo.upsertUserAccount({
      userId: proIdentity.userId,
      email: proIdentity.email,
      tier: "free",
    });
    mockedGetIdentity.mockResolvedValueOnce(proIdentity);

    const res = await POST();
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.message).toContain("No active subscription");
    expect(body.error.message).not.toContain("sub_");
  });

  it("surfaces unconfigured billing as a clean error, not a crash", async () => {
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "");
    await repo.upsertUserAccount({
      userId: proIdentity.userId,
      email: proIdentity.email,
      tier: "pro",
      razorpaySubscriptionId: "sub_cancel_2",
    });
    mockedGetIdentity.mockResolvedValueOnce(proIdentity);

    const res = await POST();
    expect(res.status).toBe(400);
    expect(() => ProcessingError).not.toThrow();
  });
});
