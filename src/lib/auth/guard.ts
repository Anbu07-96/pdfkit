import "server-only";

import { redirect } from "next/navigation";
import { getUserIdentity } from "@/lib/auth/session";
import type { UserIdentity } from "@/lib/auth/types";

/**
 * Require authentication for protected routes/actions.
 * Redirects anonymous users to `/login` if `redirectToLogin` is true (default).
 */
export async function requireAuthentication(
  redirectToLogin = true,
): Promise<UserIdentity | null> {
  const identity = await getUserIdentity();

  if (!identity.isAuthenticated) {
    if (redirectToLogin) {
      redirect("/login");
    }
    return null;
  }

  return identity;
}
