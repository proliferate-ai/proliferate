import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { Settings, SplitPanel } from "@/components/ui/icons";

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
        <IconButton
          size="xs"
          tone="sidebar"
          className="ui-icon-button workspace-shell-icon-button workspace-shell-toolbar-button glass-editor-panel-new-tab-menu-trigger"
          onClick={onOpenRepoSettings}
        >
          <Settings className="ui-icon" />
          <span className="sr-only">Repo&apos;s settings</span>
        </IconButton>
      </div>
      <div className="editor-panel-overflow-action">
        <IconButton
          size="xs"
          tone="sidebar"
          className="ui-icon-button workspace-shell-icon-button workspace-shell-toolbar-button glass-editor-panel-new-tab-menu-trigger"
          onClick={onTogglePanel}
        >
          <SplitPanel className="ui-icon" />
          <span className="sr-only">Hide side panel</span>
        </IconButton>
      </div>
    </div>
  );
}
