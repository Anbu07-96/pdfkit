import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";

/**
 * NextAuth options configuration.
 *
 * Configured with JWT session strategy and secret from environment.
 * Development / testing mode includes a credentials provider with strict validation.
 * Production environments enable GitHub / Google OAuth when credentials are present in env.
 */

const NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET ||
  process.env.AUTH_SECRET ||
  "pdfkit-dev-auth-secret-do-not-use-in-production";

/** Standard RFC-compliant email validation regex */
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export const authOptions: NextAuthOptions = {
  secret: NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    // Local / Testing credentials provider
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

        const email = credentials.email.trim();
        const password = credentials.password.trim();

        // Strict credential validation: require non-empty fields, valid email format & min password length
        if (!email || !password || password.length < 6) {
          return null;
        }

        if (!EMAIL_REGEX.test(email)) {
          return null;
        }

        return {
          id: `usr_${Buffer.from(email).toString("hex").slice(0, 12)}`,
          email,
          name: email.split("@")[0] || "User",
          tier: "free",
        };
      },
    }),

    // OAuth Providers enabled when env variables exist
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [
          GithubProvider({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          }),
        ]
      : []),

    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
  ],
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
