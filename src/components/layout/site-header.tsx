import { Container } from "@/components/layout/container";
import { DesktopNav } from "@/components/layout/desktop-nav";
import { Logo } from "@/components/layout/logo";
import { MobileNav } from "@/components/layout/mobile-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserNav } from "@/components/auth/user-nav";
import { ButtonLink } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-sm">
      <Container className="flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Logo />
          <DesktopNav />
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <UserNav />
          <ButtonLink href="/tools" size="sm" className="hidden sm:inline-flex">
            Browse tools
          </ButtonLink>
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}
