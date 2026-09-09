import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountPage from "@/app/account/page";
import * as session from "@/lib/auth/session";
import {
  InMemoryUsageRepository,
  setUsageRepositoryOverride,
} from "@/lib/usage/repository";

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const original = await importOriginal<typeof session>();
  return {
    ...original,
    getUserIdentity: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: vi.fn().mockReturnValue({ push: vi.fn(), refresh: vi.fn() }),
}));

import { redirect } from "next/navigation";

const mockedGetIdentity = vi.mocked(session.getUserIdentity);
const mockedRedirect = vi.mocked(redirect);

/**
 * Phase 66 — account/subscription UX: verification state, plan metadata,
 * subscription management section.
 */
describe("AccountPage", () => {
  let repo: InMemoryUsageRepository;

  beforeEach(() => {
    repo = new InMemoryUsageRepository();
    setUsageRepositoryOverride(repo);
  });

  afterEach(() => {
    setUsageRepositoryOverride(null);
    vi.clearAllMocks();
  });

  it("redirects anonymous users to /login", async () => {
    mockedGetIdentity.mockResolvedValueOnce(session.ANONYMOUS_USER_IDENTITY);

    await AccountPage();
    expect(mockedRedirect).toHaveBeenCalledWith("/login");
  });

  it("renders profile details and usage quota for authenticated users", async () => {
    await repo.upsertUserAccount({
      userId: "usr_test123",
      email: "bob@phase66.test",
      tier: "free",
      accountTrustStatus: "verified",
    });
    mockedGetIdentity.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "usr_test123",
      email: "bob@phase66.test",
      name: "Bob",
      status: "active",
      tier: "free",
    });

    const jsx = await AccountPage();
    render(jsx);

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("bob@phase66.test")).toBeInTheDocument();
    expect(screen.getByText("Today's Usage Quotas")).toBeInTheDocument();
    expect(screen.getByText("Jobs Processed")).toBeInTheDocument();
  });

  it("shows the verification state (verified accounts)", async () => {
    await repo.upsertUserAccount({
      userId: "usr_test123",
      email: "bob@phase66.test",
      tier: "free",
      accountTrustStatus: "verified",
    });
    mockedGetIdentity.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "usr_test123",
      email: "bob@phase66.test",
      name: "Bob",
      status: "active",
      tier: "free",
    });

    render(await AccountPage());
    expect(screen.getByText("Email Verification")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("shows the unverified state honestly for unverified accounts", async () => {
    await repo.upsertUserAccount({
      userId: "usr_test123",
      email: "bob@phase66.test",
      tier: "free",
      accountTrustStatus: "unverified",
    });
    mockedGetIdentity.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "usr_test123",
      email: "bob@phase66.test",
      name: "Bob",
      status: "active",
      tier: "free",
    });

    render(await AccountPage());
    expect(
      screen.getByText(/Unverified — check your inbox/i),
    ).toBeInTheDocument();
  });

  it("shows the subscription management section for subscribed Pro users", async () => {
    await repo.upsertUserAccount({
      userId: "usr_pro_sub",
      email: "pro@phase66.test",
      tier: "pro",
      accountTrustStatus: "verified",
      razorpaySubscriptionId: "sub_test_1",
    });
    mockedGetIdentity.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "usr_pro_sub",
      email: "pro@phase66.test",
      name: "Pro User",
      status: "active",
      tier: "pro",
    });

    render(await AccountPage());
    expect(screen.getByText("Subscription")).toBeInTheDocument();
    expect(screen.getByText("Cancel subscription")).toBeInTheDocument();
    // No upgrade CTA for already-subscribed users.
    expect(screen.queryByText("Upgrade to Pro")).not.toBeInTheDocument();
  });

  it("does not show cancellation for users without a Razorpay subscription", async () => {
    await repo.upsertUserAccount({
      userId: "usr_free_no_sub",
      email: "free@phase66.test",
      tier: "free",
    });
    mockedGetIdentity.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "usr_free_no_sub",
      email: "free@phase66.test",
      name: "Free User",
      status: "active",
      tier: "free",
    });

    render(await AccountPage());
    expect(screen.queryByText("Subscription")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancel subscription")).not.toBeInTheDocument();
  });

  it("never exposes the Razorpay subscription id or billing provider ids", async () => {
    await repo.upsertUserAccount({
      userId: "usr_pro_sub",
      email: "pro@phase66.test",
      tier: "pro",
      razorpaySubscriptionId: "sub_secret_value",
    });
    mockedGetIdentity.mockResolvedValueOnce({
      isAuthenticated: true,
      userId: "usr_pro_sub",
      email: "pro@phase66.test",
      name: "Pro User",
      status: "active",
      tier: "pro",
    });

    render(await AccountPage());
    expect(screen.queryByText(/sub_secret_value/)).not.toBeInTheDocument();
  });
});
