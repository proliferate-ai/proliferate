import { IconButton } from "@proliferate/ui/primitives/IconButton";
import { ShortcutBadge } from "@proliferate/ui/layout/ShortcutBadge";
import { Settings, SplitPanel } from "@proliferate/ui/icons";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";

interface RightPanelHeaderActionsProps {
  onOpenRepoSettings: () => void;
  onTogglePanel: () => void;
  shortcutRevealVisible: boolean;
}

export function RightPanelHeaderActions({
  onOpenRepoSettings,
  onTogglePanel,
  shortcutRevealVisible,
}: RightPanelHeaderActionsProps) {
  return (
    <div className="ui-tab-system-section ui-tab-system-section__trailing" role="presentation">
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
      <div className="editor-panel-overflow-action">
        <IconButton
          size="xs"
          tone="sidebar"
          className="ui-icon-button workspace-shell-icon-button glass-editor-panel-new-tab-menu-trigger relative"
          onClick={onTogglePanel}
        >
          <SplitPanel className="ui-icon" />
          <ShortcutBadge
            label={getShortcutDisplayLabel(SHORTCUTS.toggleRightPanel)}
            className={`pointer-events-none absolute -right-1 -bottom-1 z-20 text-muted-foreground opacity-0 transition-opacity duration-150 ${
              shortcutRevealVisible ? "opacity-100" : ""
            }`}
          />
          <span className="sr-only">Hide side panel</span>
        </IconButton>
      </div>
    </div>
  );
}
