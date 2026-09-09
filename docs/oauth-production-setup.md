# OAuth Production Setup (Google & Microsoft)

**Phase 66 · Status: NOT VERIFIED against real providers.** The provider code is implemented and conditionally enabled by environment variables, but the complete flows (consent → callback → account linking → session) have never executed with real credentials. Do not claim OAuth works until this document's verification checklist has been run with real credentials on the final domain.

## 1. How providers load

Both providers are **conditionally enabled** by NextAuth (`src/lib/auth/config.ts`):

| Provider | Required variables | Notes |
| --- | --- | --- |
| Google | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | both must be set together |
| Microsoft (Azure AD) | `AZURE_AD_CLIENT_ID` + `AZURE_AD_CLIENT_SECRET` (or `MICROSOFT_*` aliases), optional `AZURE_AD_TENANT_ID` (default `common`) | personal + work accounts by default |

With neither configured, only the credentials provider is active — sign-in works with email + password, and `/api/auth/providers` lists `credentials` only. This is the current staging behavior (fail-safe, verified).

## 2. Callback URLs the owner must configure

Once the final production domain is known (call it `https://pdfkit.example` — replace with the real domain):

**Google Cloud Console** → APIs & Services → Credentials → OAuth 2.0 Client ID (Web application):

```
Authorized redirect URI:  https://pdfkit.example/api/auth/callback/google
Authorized JavaScript origin: https://pdfkit.example
```

**Microsoft Entra admin center** → App registrations → your app → Authentication → Add platform (Web):

```
Redirect URI:  https://pdfkit.example/api/auth/callback/azure-ad
```

For local testing (if ever needed): `http://localhost:3000/api/auth/callback/{google|azure-ad}` — but do not ship localhost URIs in the production app registration.

Environment (names only — values come from the consoles above):

```
NEXTAUTH_URL=https://pdfkit.example
GOOGLE_CLIENT_ID=…          GOOGLE_CLIENT_SECRET=…
AZURE_AD_CLIENT_ID=…        AZURE_AD_CLIENT_SECRET=…   AZURE_AD_TENANT_ID=common
```

## 3. Account behavior today (code-audited)

- **Email normalization**: OAuth emails are compared case-insensitively against existing accounts by NextAuth's default account-linking rules; `getUserIdentity` keys accounts by the provider user id, with the email as fallback.
- **Duplicate accounts**: a credentials account and an OAuth account with the same address may coexist as separate rows (NextAuth default `allowLinking` semantics). *OWNER DECISION before launch:* whether to keep default behavior or add explicit linking UI. Keep as-is if acceptable; document on the login page.
- **OAuth-only users** cannot use password reset (no password hash stored) — the reset endpoint responds generically (no enumeration) and no token is created. This is correct and verified by tests.
- **Tier**: OAuth accounts default to Free; upgrades follow the same Razorpay path.
- **Sessions**: JWT, 30-day, HttpOnly, SameSite=Lax; tier is re-read from the database on every request (DB is the entitlement source of truth).

## 4. Verification checklist (run with real credentials — BLOCKED until then)

1. `NEXTAUTH_URL` set to the production origin; `npm run validate:production` reports no OAuth owner actions.
2. `/login` shows the Google and Microsoft buttons (they render when env vars exist).
3. Complete a Google sign-in: consent → callback → session (`/api/auth/session` shows the account email).
4. Complete a Microsoft sign-in the same way.
5. Sign out; sign in again — session persistence.
6. Verify a credentials-registered user and an OAuth sign-in with the same address behave per the linking decision in §3.
7. Check the callback for a *denied* consent — must land on the login page with an error, not a crash.

**Only after all seven pass may the application claim Google/Microsoft OAuth works.**

## 5. Security notes

- Client secrets live only in server env — never in `NEXT_PUBLIC_*` (those are exposed to browsers).
- `NEXTAUTH_SECRET` must be a strong 32+ byte value (validated by `npm run validate:production`).
- OAuth state/nonce handling is NextAuth's; no custom callback code exists to bypass it.
