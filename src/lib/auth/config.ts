import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import {
  validateAndNormalizeEmail,
} from "@/lib/auth/validation";
import {
  checkLoginLockout,
  clearFailedLogin,
  recordFailedLogin,
} from "@/lib/auth/failed-login-tracker";
import { verifyPassword } from "@/lib/auth/password";
import { getUsageRepository } from "@/lib/usage/repository";

/**
 * Resolves active NextAuth providers dynamically based on environment variables.
 * Disables GitHub completely, and enables Google / Microsoft OAuth when secrets exist.
 */
export function getAuthProviders() {
  return [
    // Credentials provider
    CredentialsProvider({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "user@example.com" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const emailResult = validateAndNormalizeEmail(credentials.email);
        if (!emailResult.isValid || !emailResult.normalizedEmail) {
          return null;
        }

        const normalizedEmail = emailResult.normalizedEmail;

        // Check server-side lockout
        const lockout = checkLoginLockout(normalizedEmail);
        if (lockout.isLocked) {
          console.warn("[auth] Login attempt rejected for a locked out email address");
          return null;
        }

        // Phase 65: verify against the STORED scrypt hash. Previously any
        // policy-valid password minted a session for any address (email-only
        // access). Policy validation now happens at registration; here the
        // stored hash is the truth.
        let account = null;
        try {
          account = await getUsageRepository().getUserAccountAuthByEmail(normalizedEmail);
        } catch (err) {
          console.error("[auth] Account lookup failed", err instanceof Error ? err.message : err);
          return null;
        }

        if (!account) {
          recordFailedLogin(normalizedEmail);
          return null;
        }

        const passwordOk = await verifyPassword(credentials.password, account.passwordHash);
        if (!passwordOk) {
          recordFailedLogin(normalizedEmail);
          return null;
        }

        if (account.status === "suspended") {
          console.warn("[auth] Login rejected for suspended account");
          return null;
        }

        // Clear failed attempts on successful login
        clearFailedLogin(normalizedEmail);

        return {
          id: account.userId,
          email: normalizedEmail,
          name: normalizedEmail.split("@")[0] || "User",
          tier: account.tier,
        };
      },
    }),

    // Google OAuth Provider
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),

    // Microsoft / Outlook (Azure AD) OAuth Provider
    ...((process.env.AZURE_AD_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID) &&
    (process.env.AZURE_AD_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET)
      ? [
          AzureADProvider({
            clientId:
              process.env.AZURE_AD_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || "",
            clientSecret:
              process.env.AZURE_AD_CLIENT_SECRET ||
              process.env.MICROSOFT_CLIENT_SECRET ||
              "",
            tenantId: process.env.AZURE_AD_TENANT_ID || "common",
          }),
        ]
      : []),
  ];
}

const NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET ||
  process.env.AUTH_SECRET ||
  "pdfkit-dev-auth-secret-do-not-use-in-production";

export const authOptions: NextAuthOptions = {
  secret: NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
  },
  providers: getAuthProviders(),
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tier = (user as { tier?: string }).tier ?? "free";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as { id?: string; tier?: string; email?: string | null; name?: string | null };
        u.id = token.id as string;
        u.tier = (token.tier as string) ?? "free";
      }
      return session;
    },
  },
};
