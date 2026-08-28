"use client";

import { LogIn, LogOut, User as UserIcon } from "lucide-react";
import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function UserNav() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="size-8 rounded-full bg-surface-muted animate-pulse" />
    );
  }

  if (!session || !session.user) {
    return (
      <Button variant="secondary" size="sm" onClick={() => signIn()}>
        <LogIn aria-hidden="true" className="size-4" />
        Sign in
      </Button>
    );
  }

  const user = session.user;
  const displayName = user.name || user.email || "Account";

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/account"
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted transition-colors"
      >
        <UserIcon aria-hidden="true" className="size-3.5 text-subtle" />
        <span className="max-w-[120px] truncate">{displayName}</span>
        <Badge tone="neutral">
          Free
        </Badge>
      </Link>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => signOut({ callbackUrl: "/" })}
        title="Sign out"
      >
        <LogOut aria-hidden="true" className="size-3.5" />
        <span className="sr-only sm:not-sr-only">Sign out</span>
      </Button>
    </div>
  );
}
