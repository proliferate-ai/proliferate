import { ComputeTargetSwatch } from "@/components/compute/ComputeTargetSwatch";
import { CloudIcon, Monitor, Terminal, Tree } from "@/components/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type { ComputeTargetAppearance } from "@/lib/domain/compute/target-appearance";
import type { SidebarWorkspaceVariant } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";

const VARIANT_ICONS: Record<SidebarWorkspaceVariant, typeof Monitor> = {
  local: Monitor,
  worktree: Tree,
  cloud: CloudIcon,
  ssh: Terminal,
};

const VARIANT_TOOLTIPS: Record<SidebarWorkspaceVariant, string> = {
  local: "Local · runs in the repo's working directory",
  worktree: "Worktree · isolated branch in a separate checkout",
  cloud: "Cloud · runs on remote infrastructure",
  ssh: "SSH target · runs on a connected target",
};

interface SidebarWorkspaceVariantIconProps {
  variant: SidebarWorkspaceVariant;
  className?: string;
  targetAppearance?: ComputeTargetAppearance | null;
  withTooltip?: boolean;
}

export function SidebarWorkspaceVariantIcon({
  variant,
  className = "size-3 text-sidebar-muted-foreground",
  targetAppearance = null,
  withTooltip = false,
}: SidebarWorkspaceVariantIconProps) {
  const Icon = VARIANT_ICONS[variant];
  const icon = variant === "ssh" && targetAppearance
    ? (
      <span className={`inline-flex shrink-0 items-center justify-center ${className}`}>
        <ComputeTargetSwatch appearance={targetAppearance} size="inherit" />
      </span>
    )
    : <Icon className={className} />;

  if (!withTooltip) {
    return icon;
  }

  return (
    <Tooltip
      content={variant === "ssh" && targetAppearance
        ? `SSH target · ${targetAppearance.displayName}`
        : VARIANT_TOOLTIPS[variant]}
      className="inline-flex shrink-0 items-center justify-center"
    >
      {icon}
    </Tooltip>
  );
}
