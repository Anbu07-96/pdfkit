# Payment Provider Strategy

**Phase 66 · Status: Razorpay test-mode ready, live mode deliberately gated.**

This document describes what is implemented today, how India-friendly it is, and how another provider could be added later **without rewriting entitlement or business logic**. No legal or tax advice is included — items needing professional review are marked.

## 1. What is implemented today

| Concern | Implementation |
| --- | --- |
| Provider | **Razorpay** (`razorpay` npm SDK, v2), India-first |
| Product | Pro plan, ₹499/month, INR, monthly subscription (12 cycles) |
| Checkout | Server-created Razorpay Subscription + Razorpay Checkout.js in the browser (`/api/billing/checkout`) |
| Verification | Client posts `payment_id / subscription_id / signature`; server verifies HMAC-SHA256(key secret, `paymentId\|subscriptionId`) AND binds the payment to **the account's own stored subscription** (Phase 66 hardening) |
| Webhooks | `POST /api/billing/webhook`, HMAC-SHA256 over the raw body, idempotent (`RazorpayWebhookEvent` table), activates Pro (`activated/authenticated/charged`), downgrades on end (`halted/completed`, `cancelled` when no paid time remains) |
| Cancellation | `/api/billing/cancel` — Razorpay `subscriptions.cancel(id, cancelAtCycleEnd=true)`; Pro access continues to the end of the paid period |
| Entitlements | **Database is the source of truth** — `getUserIdentity()` reads the account tier from PostgreSQL on every request; client-supplied tier values are never trusted |
| Modes | `disabled` / `test` / `live` derived from the key prefix (`rzp_test_` / `rzp_live_`); live additionally requires `PDFKIT_BILLING_ALLOW_LIVE=true` (fail-closed two-key design) |
| Payment data | PDFKit stores only Razorpay customer/subscription ids + tier/status. **No card data, no UPI credentials, ever.** |

Plan metadata (names, prices, quotas, features) lives in one place: `src/lib/billing/plans.ts` — the pricing page, account page and checkout all read from it.

## 2. India considerations

- **Currency & pricing** — INR-first (₹499 Pro). Display prices are in the catalog; the amount handed to Razorpay comes from the same constant. INR is the only configured currency today.
- **UPI / cards / netbanking** — all handled inside Razorpay Checkout (UPI, Google Pay, PhonePe, Paytm, RuPay/Visa/Mastercard, netbanking, international cards). PDFKit does not implement or store any payment instrument.
- **Recurring subscriptions** — Razorpay Subscriptions handle mandates/UPI auto-debit and retry semantics. The `subscription.halted` webhook (charges failing) downgrades the account when the paid period ends; `subscription.charged` keeps it active.
- **Webhook reliability** — webhooks are idempotent (duplicate event ids are ignored), signature-verified, and out-of-order tolerant (activation and cancellation events are both handled; a stale activation cannot resurrect a cancelled subscription because the cancel path is end-state-driven).
- **Refunds/cancellation** — cancellation is self-service at period end; refunds are case-by-case under `/refund-policy` and executed through the Razorpay dashboard by the operator.
- **Tax (GST)** — *MARKED FOR ACCOUNTANT REVIEW:* whether to add GST to the ₹499 price, register for GST, file GSTR returns, and issue invoices via Razorpay Invoices is an owner decision. The pricing page states "GST may apply". No tax logic is implemented; Razorpay can be configured to handle tax display at checkout by the operator.

## 3. Adding another provider later (adapter strategy)

The current `BillingService` is Razorpay-shaped but the **business logic it drives is provider-neutral**:

```
plan catalog (prices, quotas, entitlement mapping)      ← provider-independent
        │
UsageRepository.upsertUserAccount({ tier, status,
  billingProvider, razorpayCustomerId, razorpaySubscriptionId })   ← provider fields
        │
entitlement resolution (getUserIdentity → DB tier)      ← provider-independent
```

To add Stripe/Cashfree/PayU later:

1. Generalize the account columns to `billingProvider`, `billingCustomerId`, `billingSubscriptionId` (a migration renaming the Razorpay-specific columns; the repository interface already abstracts them behind `getUserAccountByRazorpay*` lookups that become `getUserAccountByBilling*`).
2. Introduce a `BillingProvider` interface — `createCheckout(identity, planId)`, `verifyPayment(...)`, `cancelAtPeriodEnd(...)`, `verifyWebhook(rawBody, signature)` — and move the Razorpay implementation behind it. The service, routes, entitlements and UI stay untouched.
3. Webhook events normalize to the same internal outcomes: `subscription.activated | subscription.ended | subscription.unmapped`.
4. Plan metadata gains one `providerPlanIds: { razorpay?: string; stripe?: string }` entry instead of a single env var.

**No second gateway is integrated in Phase 66** — the current implementation is kept, and the above is the documented path.

## 5. Operational rules (already enforced in code)

- Live mode requires live keys **and** `PDFKIT_BILLING_ALLOW_LIVE=true`. A leaked or accidentally-set live key alone keeps billing disabled.
- Unknown key formats disable billing (no guessing).
- Only verified provider state (signature-verified payment verification or webhooks) changes a tier — client-side checkout completion alone never does.
- `subscription.cancelled` with paid time remaining does **not** downgrade (the user paid for that period); `completed`/`halted` do.
