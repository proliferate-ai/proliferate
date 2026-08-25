import { CloudIcon, Monitor } from "#product/primitives/icons/platform";
import { Tree } from "#product/primitives/icons/workspace-git";
import { Tooltip } from "#product/primitives/Tooltip";
import type { SidebarWorkspaceVariant } from "#product/lib/domain/workspaces/sidebar/sidebar-indicators";

const VARIANT_ICONS: Record<SidebarWorkspaceVariant, typeof Monitor> = {
  local: Monitor,
  worktree: Tree,
  cloud: CloudIcon,
};

const VARIANT_TOOLTIPS: Record<SidebarWorkspaceVariant, string> = {
  local: "Local · runs in the repo's working directory",
  worktree: "Worktree · isolated branch in a separate checkout",
  cloud: "Cloud · runs on remote infrastructure",
};

interface SidebarWorkspaceVariantIconProps {
  variant: SidebarWorkspaceVariant;
  className?: string;
  withTooltip?: boolean;
}

export function SidebarWorkspaceVariantIcon({
  variant,
  className = "icon-compact text-sidebar-muted-foreground",
  withTooltip = false,
}: SidebarWorkspaceVariantIconProps) {
  const Icon = VARIANT_ICONS[variant];
  const icon = <Icon className={className} />;

  if (!withTooltip) {
    return icon;
  }

  return (
    <Tooltip
      content={VARIANT_TOOLTIPS[variant]}
      className="inline-flex shrink-0 items-center justify-center"
    >
      {icon}
    </Tooltip>
  );
}
