/**
 * User Identity & Account Types (Phase 42).
 *
 * Provider-neutral identity types so the rest of PDFKit does NOT depend
 * directly on NextAuth or third-party authentication vendor internals.
 */

export type UserAccountTier = "anonymous" | "free" | "pro" | "business";
export type UserAccountStatus = "anonymous" | "active" | "suspended";

export interface UserIdentity {
  /** True when the user is authenticated in an active session. */
  isAuthenticated: boolean;
  /** Unique user ID ("anon" for unauthenticated visitors). */
  userId: string;
  /** User's primary email address, or null if anonymous. */
  email: string | null;
  /** User's display name, or null if unprovided/anonymous. */
  name: string | null;
  /** Account status. */
  status: UserAccountStatus;
  /** Account plan tier placeholder for monetization. */
  tier: UserAccountTier;
}
