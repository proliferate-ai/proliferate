import type { ComponentType } from "react";
import {
  CloudIcon,
  Folder,
  GitBranchIcon,
  type IconProps,
} from "@/components/ui/icons";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import type { SidebarWorkspaceVariant } from "@/lib/domain/workspaces/sidebar/sidebar-indicators";

const VARIANT_ICONS: Record<SidebarWorkspaceVariant, ComponentType<IconProps>> = {
  local: Folder,
  worktree: GitBranchIcon,
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
  className = "size-3 text-sidebar-muted-foreground",
  withTooltip = false,
}: SidebarWorkspaceVariantIconProps) {
  const Icon = VARIANT_ICONS[variant];
  const icon = <Icon className={className} />;

  if (!withTooltip) {
    return icon;
  }

  return (
    <Tooltip content={VARIANT_TOOLTIPS[variant]} className="inline-flex shrink-0 items-center justify-center">
      {icon}
    </Tooltip>
  );
}
