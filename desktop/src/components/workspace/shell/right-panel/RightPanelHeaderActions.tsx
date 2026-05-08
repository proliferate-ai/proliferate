import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { Settings } from "@/components/ui/icons";
import { RightPanelNewTabMenu } from "@/components/workspace/shell/right-panel/RightPanelNewTabMenu";
import type { RightPanelNewTabMenuDefault } from "@/lib/infra/right-panel-new-tab-menu";

interface RightPanelHeaderActionsProps {
  newTabMenuOpen: boolean;
  newTabMenuDefaultKind: RightPanelNewTabMenuDefault;
  isWorkspaceReady: boolean;
  canCreateBrowserTab: boolean;
  onNewTabMenuOpenChange: (isOpen: boolean) => void;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  onOpenRepoSettings: () => void;
}

export function RightPanelHeaderActions({
  newTabMenuOpen,
  newTabMenuDefaultKind,
  isWorkspaceReady,
  canCreateBrowserTab,
  onNewTabMenuOpenChange,
  onCreateTerminal,
  onCreateBrowser,
  onOpenRepoSettings,
}: RightPanelHeaderActionsProps) {
  return (
    <div className="ui-tab-system-section ui-tab-system-section__trailing">
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
        <RightPanelNewTabMenu
          open={newTabMenuOpen}
          defaultKind={newTabMenuDefaultKind}
          isWorkspaceReady={isWorkspaceReady}
          canCreateBrowserTab={canCreateBrowserTab}
          onOpenChange={onNewTabMenuOpenChange}
          onCreateTerminal={onCreateTerminal}
          onCreateBrowser={onCreateBrowser}
        />
      </div>
    </div>
  );
}
