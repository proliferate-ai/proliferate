import type { RecentWorkStatusIndicatorView } from "@proliferate/product-domain/workspaces/cloud-work-inventory";

export interface RecentWorkStatusDotProps {
  indicator: RecentWorkStatusIndicatorView;
  showLabel?: boolean;
  surface?: "default" | "sidebar";
  className?: string;
}

export function RecentWorkStatusDot({
  indicator,
  showLabel = false,
  surface = "default",
  className = "",
}: RecentWorkStatusDotProps) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 ${statusToneClass(indicator, surface)} ${className}`}
      title={indicator.label}
      aria-label={indicator.label}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${
          indicator.hollow ? "border border-current bg-transparent" : "bg-current"
        } ${indicator.live ? "animate-pulse" : ""}`}
      />
      {showLabel ? (
        <span className="min-w-0 truncate text-xs leading-4">
          {indicator.label}
        </span>
      ) : null}
    </span>
  );
}

function statusToneClass(
  indicator: RecentWorkStatusIndicatorView,
  surface: RecentWorkStatusDotProps["surface"],
): string {
  switch (indicator.tone) {
    case "attention":
      return "text-warning";
    case "progress":
      return "text-info";
    case "success":
      return "text-success";
    case "danger":
      return "text-destructive";
    case "muted":
      return surface === "sidebar" ? "text-sidebar-muted-foreground" : "text-muted-foreground";
  }
}
