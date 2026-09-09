# Transactional Email Production Setup

**Phase 66 · Status: SMTP transport implemented, not verified against a real provider.** Delivery has not been executed end-to-end (no SMTP credentials in this environment). The code path is `src/lib/email/transport.ts` (nodemailer, pure JS — no native binaries).

## 1. What sends email (and what doesn't)

| Email | Trigger | Token lifetime | Notes |
| --- | --- | --- | --- |
| Address verification | registration | 24 h, one-time link | link logged (no PII) only in non-production when SMTP is unset |
| Password reset | `/api/auth/reset-request` | 1 h, one-time; stored as SHA-256 hash | reset link is **never** logged anywhere |
| Billing notices | — | — | not implemented; subscription state is visible on /account |

No newsletters, no marketing lists. The reset endpoint fails **closed** in production when SMTP is unconfigured (generic 503, no enumeration).

## 2. Environment variables (names only)

```
SMTP_HOST=smtp.provider.example   # enables real delivery
SMTP_PORT=587                     # 465 with SMTP_SECURE=true
SMTP_SECURE=false                 # true for implicit TLS (port 465)
SMTP_USER=…                       # optional depending on provider
SMTP_PASS=…                       # SECRET — provider password or API key
SMTP_FROM="PDFKit <no-reply@your-domain>"
```

Without `SMTP_HOST`: development logs verification links (never addresses); production **fails clearly** instead of silently dropping mail. `npm run validate:production` flags a missing SMTP_HOST as an owner action.

## 3. Sender domain requirements (DNS — owner action, high level)

For reliable delivery of transactional mail from `your-domain`:

1. **SPF** — a TXT record authorizing your email provider's servers to send for the domain.
2. **DKIM** — provider-generated key published as a DNS TXT record; enables signing (transport uses whatever the provider requires).
3. **DMARC** — a policy record (start at `p=none` with `rua=` reporting) aligned with SPF/DKIM.

Exact records come from the chosen provider's dashboard — DNS cannot be configured from this repository, and no DNS claims are made here.

## 4. Provider options (any SMTP provider works)

- Amazon SES, Postmark, Resend, SendGrid, Zoho Mail, Google Workspace — all expose SMTP.
- Choose one with a dedicated transactional pool; set a verified `SMTP_FROM`.
- Rate/signature details (API keys vs SMTP passwords) differ per provider; only `SMTP_PASS` changes.

## 5. Verification checklist (BLOCKED until real credentials)

1. Configure the provider, set the variables, run `npm run validate:production` (no email owner actions).
2. Register a new account → verification email arrives → link verifies the address (`accountTrustStatus=verified`).
3. Request a password reset → email arrives → new password works, old sessions are invalidated.
4. Confirm no address or token appears in server logs during both flows.
