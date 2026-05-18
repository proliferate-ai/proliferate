import { Badge } from "../primitives/Badge";

type AutomationStatus = "enabled" | "paused" | "failed";

interface AutomationStatusBadgeProps {
  status: AutomationStatus;
}

export function AutomationStatusBadge({ status }: AutomationStatusBadgeProps) {
  const tone = status === "enabled" ? "success" : status === "failed" ? "destructive" : "neutral";
  const label = status === "enabled" ? "On" : status === "failed" ? "Failed" : "Paused";
  return <Badge tone={tone}>{label}</Badge>;
}
