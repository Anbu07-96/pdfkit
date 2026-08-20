import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { ToolStatus, ToolTier } from "@/lib/tools";

const STATUS_LABEL: Record<ToolStatus, string> = {
  AVAILABLE: "Available",
  COMING_SOON: "Coming soon",
  PRO: "Pro",
  DISABLED: "Unavailable",
};

const STATUS_TONE: Record<ToolStatus, BadgeTone> = {
  AVAILABLE: "success",
  COMING_SOON: "neutral",
  PRO: "primary",
  DISABLED: "warning",
};

export interface ToolStatusBadgeProps {
  status: ToolStatus;
  /** Shown alongside "Coming soon" as "Planned for Pro". Never implies access. */
  plannedTier?: ToolTier;
  className?: string;
}

/**
 * Availability badge. Text carries the meaning, colour only reinforces it, so
 * the state is not communicated by colour alone.
 */
export function ToolStatusBadge({
  status,
  plannedTier,
  className,
}: ToolStatusBadgeProps) {
  const label =
    status === "COMING_SOON" && plannedTier === "pro"
      ? "Coming soon · Pro"
      : STATUS_LABEL[status];

  return (
    <Badge tone={STATUS_TONE[status]} className={className}>
      {label}
    </Badge>
  );
}
