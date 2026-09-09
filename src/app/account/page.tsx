import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserIdentity } from "@/lib/auth/session";
import { getUsageService } from "@/lib/usage/service";
import { getUsageRepository } from "@/lib/usage/repository";
import { getPlan, formatInr, ANONYMOUS_LIMITS } from "@/lib/billing/plans";
import { getBillingModeLabel } from "@/lib/billing/config";
import { formatBytes } from "@/lib/utils/format";
import { Badge } from "@/components/ui/badge";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { CancelSubscriptionButton } from "@/components/billing/cancel-subscription-button";

export const metadata: Metadata = {
  title: "Account",
  description: "View and manage your PDFKit account, plan, billing and usage quotas.",
};

export default async function AccountPage() {
  const identity = await getUserIdentity();

  if (!identity.isAuthenticated) {
    redirect("/login");
  }

  const usageService = getUsageService();
  const usage = await usageService.getUserSummary(identity);

  // Account row for verification state and subscription presence (Phase 66).
  const account = await getUsageRepository()
    .getUserAccount(identity.userId)
    .catch(() => null);
  const plan = getPlan(identity.tier);
  const proPlan = getPlan("pro");
  const verified = account?.accountTrustStatus === "verified";
  const hasRazorpaySubscription = Boolean(account?.razorpaySubscriptionId);
  const billingMode = getBillingModeLabel();

  return (
    <ContentPage
      title="My Account"
      intro="Your account identity, plan status and usage quota metrics."
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Account" }]}
    >
      <Prose>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs not-prose space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {identity.name || identity.email || "Account"}
              </h2>
              <p className="text-xs text-muted mt-0.5">{identity.email}</p>
            </div>
            <Badge tone="neutral">
              {(plan?.name ?? identity.tier).toUpperCase()} PLAN
            </Badge>
          </div>

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs font-medium text-subtle">Account Status</dt>
              <dd className="mt-1 text-xs font-medium text-success capitalize">
                {identity.status}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-subtle">Email Verification</dt>
              <dd className="mt-1 text-xs font-medium">
                {verified ? (
                  <span className="text-success">Verified</span>
                ) : (
                  <span className="text-muted">
                    Unverified — check your inbox for the verification link
                  </span>
                )}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-subtle">Plan</dt>
              <dd className="mt-1 text-xs text-foreground">
                {plan ? `${plan.name} — ${formatInr(plan.monthlyPriceMinor)} / month` : "Free"}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-subtle">Quota Period</dt>
              <dd className="mt-1 text-xs font-mono text-muted">
                {usage.periodDate} (Daily)
              </dd>
            </div>
          </dl>

          <UpgradeButton
            currentTier={identity.tier}
            priceLabel={proPlan ? `${formatInr(proPlan.monthlyPriceMinor)} / month` : undefined}
            planBlurb={
              proPlan
                ? `Upgrade with Razorpay for ${proPlan.dailyJobLimit.toLocaleString("en-IN")} jobs/day and ${formatBytes(proPlan.dailyByteLimit, 0)} daily volume. Anonymous and Free access remain available.`
                : undefined
            }
          />

          {identity.tier === "pro" && hasRazorpaySubscription ? (
            <div className="rounded-xl border border-border bg-surface-hover/30 p-4 space-y-2">
              <div className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Subscription
              </div>
              <p className="text-xs text-muted">
                Active subscription billed monthly through Razorpay. Cancelling
                takes effect at the end of the period you have already paid
                for — your Pro quotas continue until then.
              </p>
              {billingMode === "test" ? (
                <p className="text-xs text-muted">
                  This deployment runs Razorpay in <strong>test mode</strong> —
                  no real charges are made.
                </p>
              ) : null}
              <CancelSubscriptionButton />
            </div>
          ) : null}

          <div className="pt-4 border-t border-border">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              Today&apos;s Usage Quotas
            </h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface-hover/50 p-4">
                <div className="text-xs font-medium text-subtle">Jobs Processed</div>
                <div className="mt-1 text-lg font-bold text-foreground">
                  {usage.jobsUsed} / {usage.dailyJobLimit}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {usage.jobsRemaining} jobs remaining today
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface-hover/50 p-4">
                <div className="text-xs font-medium text-subtle">Data Volume</div>
                <div className="mt-1 text-lg font-bold text-foreground">
                  {formatBytes(usage.bytesUsed, 0)} / {formatBytes(usage.dailyByteLimit, 0)}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {formatBytes(usage.bytesRemaining, 0)} remaining today
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs text-muted">
              Anonymous visitors get {ANONYMOUS_LIMITS.dailyJobLimit} jobs/day
              ({formatBytes(ANONYMOUS_LIMITS.dailyByteLimit, 0)}). Every plan
              includes all available tools within its daily quotas.
            </p>
          </div>
        </div>
      </Prose>
    </ContentPage>
  );
}
