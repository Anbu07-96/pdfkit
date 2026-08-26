import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUserIdentity } from "@/lib/auth/session";
import { getUsageService } from "@/lib/usage/service";
import { formatBytes } from "@/lib/utils/format";
import { Badge } from "@/components/ui/badge";
import { ContentPage, Prose } from "@/components/layout/content-page";
import { UpgradeButton } from "@/components/billing/upgrade-button";

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
              {identity.tier.toUpperCase()} PLAN
            </Badge>
          </div>

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs font-medium text-subtle">User ID</dt>
              <dd className="mt-1 font-mono text-xs text-foreground break-all">
                {identity.userId}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-subtle">Account Status</dt>
              <dd className="mt-1 text-xs font-medium text-success capitalize">
                {identity.status}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-subtle">Plan Tier</dt>
              <dd className="mt-1 text-xs text-foreground capitalize">
                {identity.tier} Plan
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium text-subtle">Quota Period</dt>
              <dd className="mt-1 text-xs font-mono text-muted">
                {usage.periodDate} (Daily)
              </dd>
            </div>
          </dl>

          <UpgradeButton currentTier={identity.tier} />

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
              PDFKit keeps all 29 online tools fully accessible to anonymous visitors and free account holders within daily quotas.
            </p>
          </div>
        </div>
      </Prose>
    </ContentPage>
  );
}
