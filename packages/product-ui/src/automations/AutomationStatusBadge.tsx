import type { ComponentProps, ReactNode } from "react";
import { Badge } from "@proliferate/ui/primitives/Badge";

interface AutomationStatusBadgeProps {
  label: ReactNode;
  tone?: ComponentProps<typeof Badge>["tone"];
}

export function AutomationStatusBadge({
  label,
  tone = "neutral",
}: AutomationStatusBadgeProps) {
  return <Badge tone={tone}>{label}</Badge>;
}
