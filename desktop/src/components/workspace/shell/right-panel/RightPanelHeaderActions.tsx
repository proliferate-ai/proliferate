import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { AppShellPanelToggleIcon, Settings } from "@/components/ui/icons";

interface RightPanelHeaderActionsProps {
  onOpenRepoSettings: () => void;
  onTogglePanel: () => void;
}

export function RightPanelHeaderActions({
  onOpenRepoSettings,
  onTogglePanel,
}: RightPanelHeaderActionsProps) {
  return (
    <div className="ui-tab-system-section ui-tab-system-section__trailing" role="presentation">
      <div className="editor-panel-overflow-action">
        <Tooltip
          content="Repo's settings"
          className="right-panel-repo-settings-tooltip"
          singleLine
        >
          <IconButton
            size="xs"
            tone="sidebar"
            title="Repo's settings"
            className="ui-icon-button glass-editor-panel-new-tab-menu-trigger"
            onClick={onOpenRepoSettings}
          >
            <Settings className="ui-icon" />
          </IconButton>
        </Tooltip>
      </div>
      <div className="editor-panel-overflow-action">
        <Tooltip
          content="Hide side panel"
          className="right-panel-hide-panel-tooltip"
          singleLine
        >
          <IconButton
            size="xs"
            tone="sidebar"
            title="Hide side panel"
            className="ui-icon-button glass-editor-panel-new-tab-menu-trigger"
            onClick={onTogglePanel}
          >
            <AppShellPanelToggleIcon className="ui-icon" />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
