"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import * as React from "react";
import { useTheme } from "@/components/theme/theme-provider";
import { Dropdown } from "@/components/ui/dropdown";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils/cn";

const OPTIONS: { id: Theme; label: string; icon: React.ReactNode }[] = [
  { id: "light", label: "Light", icon: <Sun /> },
  { id: "dark", label: "Dark", icon: <Moon /> },
  { id: "system", label: "System", icon: <Monitor /> },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const current = OPTIONS.find((option) => option.id === theme) ?? OPTIONS[2];
  const triggerIcon = resolvedTheme === "dark" ? (
    <Moon aria-hidden="true" className="size-5" />
  ) : (
    <Sun aria-hidden="true" className="size-5" />
  );

  return (
    <Dropdown
      label="Theme"
      className={className}
      items={OPTIONS.map((option) => ({
        id: option.id,
        label: option.label,
        icon: option.icon,
        selected: theme === option.id,
        onSelect: () => setTheme(option.id),
      }))}
      trigger={({ ref, ...triggerProps }) => (
        <button
          ref={ref}
          type="button"
          aria-label={`Theme: ${current.label}. Change theme`}
          className={cn(
            "inline-flex size-11 items-center justify-center rounded-lg text-muted transition-colors sm:size-10",
            "hover:bg-surface-muted hover:text-foreground",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          )}
          {...triggerProps}
        >
          {triggerIcon}
        </button>
      )}
    />
  );
}
