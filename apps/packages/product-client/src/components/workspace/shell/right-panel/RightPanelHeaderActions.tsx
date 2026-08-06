import { IconButton } from "#product/primitives/IconButton";
import { Settings } from "#product/primitives/icons/core";

interface RightPanelHeaderActionsProps {
  onOpenRepoSettings: () => void;
}

export function RightPanelHeaderActions({
  onOpenRepoSettings,
}: RightPanelHeaderActionsProps) {
  return (
    <div
      className="ui-tab-system-section ui-tab-system-section__trailing"
      style={{ paddingRight: "calc(var(--workspace-shell-action-size) + 0.25rem)" }}
      role="presentation"
    >
      <div className="editor-panel-overflow-action">
        <IconButton
          size="xs"
          tone="sidebar"
          className="ui-icon-button workspace-shell-icon-button glass-editor-panel-new-tab-menu-trigger"
          onClick={onOpenRepoSettings}
        >
          <Settings className="ui-icon" />
          <span className="sr-only">Repo&apos;s settings</span>
        </IconButton>
      </div>
    </div>
  );
}
