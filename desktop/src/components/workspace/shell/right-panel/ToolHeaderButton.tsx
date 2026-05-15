import type { ComponentType } from "react";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  CloudIcon,
  AppShellReviewIcon,
  FileIcon,
  type IconProps,
} from "@/components/ui/icons";
import type { RightPanelTool } from "@/lib/domain/workspaces/shell/right-panel-model";

const HEADER_TOOL_TAB_CLASS = "ui-tab-system-tab right-panel-tool-tab";

interface ToolHeaderButtonProps {
  tool: RightPanelTool;
  isActive: boolean;
  isDragging: boolean;
  shouldSuppressClick: () => boolean;
  onSelect: () => void;
}

interface ToolConfig {
  label: string;
  icon: ComponentType<IconProps>;
}

const PANEL_TOOLS: Record<RightPanelTool, ToolConfig> = {
  files: { label: "Files", icon: FileIcon },
  git: { label: "Changes", icon: AppShellReviewIcon },
  settings: { label: "Cloud environment", icon: CloudIcon },
};

export function ToolHeaderButton({
  tool,
  isActive,
  isDragging,
  shouldSuppressClick,
  onSelect,
}: ToolHeaderButtonProps) {
  const panelTool = PANEL_TOOLS[tool];
  const Icon = panelTool.icon;

  return (
    <Tooltip
      content={panelTool.label}
      className="right-panel-tab-tooltip"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        role="tab"
        aria-selected={isActive}
        aria-controls={`tabpanel-workspace-right-panel-${tool}`}
        tabIndex={isActive ? 0 : -1}
        data-reorderable="true"
        data-active={isActive ? true : undefined}
        aria-grabbed={isDragging}
        aria-label={panelTool.label}
        onClick={() => {
          if (shouldSuppressClick()) {
            return;
          }
          onSelect();
        }}
        className={HEADER_TOOL_TAB_CLASS}
      >
        <span className="ui-tab-system-tab__content">
          <Icon className="ui-tab-system-tab__icon" />
          <span className="ui-tab-system-tab__label">
            <span className="ui-tab-system-tab__label-primary">{panelTool.label}</span>
          </span>
          <span
            className="ui-tab-system-tab__dirty-indicator"
            aria-hidden="true"
          />
        </span>
      </Button>
    </Tooltip>
  );
}
