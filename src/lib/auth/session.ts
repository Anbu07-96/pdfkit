import "server-only";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import type { UserIdentity } from "@/lib/auth/types";
import { getUsageRepository } from "@/lib/usage/repository";

/** Anonymous visitor identity fallback. */
export const ANONYMOUS_USER_IDENTITY: UserIdentity = {
  isAuthenticated: false,
  userId: "anon",
  email: null,
  name: null,
  status: "anonymous",
  tier: "anonymous",
};

/**
 * Server-side identity resolver.
 *
 * Inspects NextAuth session and returns a provider-neutral {@link UserIdentity}.
 * Synchronizes with database user account tier/status when present.
 * Falls back safely to {@link ANONYMOUS_USER_IDENTITY} when unauthenticated or
 * when authentication is disabled/unconfigured.
 */
export async function getUserIdentity(): Promise<UserIdentity> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return ANONYMOUS_USER_IDENTITY;
    }

    const user = session.user as {
      id?: string;
      email?: string | null;
      name?: string | null;
      tier?: string;
    };

    const userId = user.id || user.email || "usr_session";
    let tier = (user.tier as UserIdentity["tier"]) || "free";
    let status: UserIdentity["status"] = "active";

    try {
      const persistedAcc = await getUsageRepository().getUserAccount(userId);
      if (persistedAcc) {
        tier = (persistedAcc.tier as UserIdentity["tier"]) || tier;
        status = (persistedAcc.status as UserIdentity["status"]) || status;
      }
    } catch {
      // Non-fatal error fallback to session defaults if usage repo fails
    }

    return {
      isAuthenticated: true,
      userId,
      email: user.email ?? null,
      name: user.name ?? null,
      status,
      tier,
    };
  } catch {
    return ANONYMOUS_USER_IDENTITY;
  }
}
