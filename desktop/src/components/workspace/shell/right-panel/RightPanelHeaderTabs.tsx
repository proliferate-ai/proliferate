import {
  useEffect,
  useState,
} from "react";
import { RightPanelHeaderActions } from "@/components/workspace/shell/right-panel/RightPanelHeaderActions";
import { RightPanelHeaderEntryList } from "@/components/workspace/shell/right-panel/RightPanelHeaderEntryList";
import { useRightPanelHeaderDrag } from "@/hooks/workspaces/ui/use-right-panel-header-drag";
import {
  type RightPanelHeaderEntryKey,
  type RightPanelTool,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import type { RightPanelHeaderEntry } from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import type { RightPanelNewTabMenuDefault } from "@/lib/infra/right-panel-new-tab-menu";

interface RightPanelHeaderTabsProps {
  entries: readonly RightPanelHeaderEntry[];
  activeEntryKey: RightPanelHeaderEntryKey;
  unreadByTerminal: Record<string, boolean>;
  isWorkspaceReady: boolean;
  canCreateBrowserTab: boolean;
  newTabMenuRequestToken: number;
  newTabMenuDefaultKind: RightPanelNewTabMenuDefault;
  onActivateTool: (tool: RightPanelTool) => void;
  onSelectTerminal: (terminalId: string) => void;
  onSelectBrowser: (browserId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCloseBrowser: (browserId: string) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  onOpenRepoSettings: () => void;
  onReorderHeaderEntry: (
    entryKey: RightPanelHeaderEntryKey,
    beforeEntryKey: RightPanelHeaderEntryKey | null,
  ) => void;
}

export function RightPanelHeaderTabs({
  entries,
  activeEntryKey,
  unreadByTerminal,
  isWorkspaceReady,
  canCreateBrowserTab,
  newTabMenuRequestToken,
  newTabMenuDefaultKind,
  onActivateTool,
  onSelectTerminal,
  onSelectBrowser,
  onCloseTerminal,
  onCloseBrowser,
  onRenameTerminal,
  onCreateTerminal,
  onCreateBrowser,
  onOpenRepoSettings,
  onReorderHeaderEntry,
}: RightPanelHeaderTabsProps) {
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  const drag = useRightPanelHeaderDrag({ onReorderHeaderEntry });

  useEffect(() => {
    if (newTabMenuRequestToken > 0) {
      setNewTabMenuOpen(true);
    }
  }, [newTabMenuRequestToken]);

  return (
    <div className="right-panel-tab-system ui-tab-system editor-panel-tab-root editor-panel-tab-root--simple-tabs border-b border-sidebar-border/70">
      <div className="ui-tab-system-bar">
        <div className="editor-panel-tab-bar-tab-cluster">
          <output
            className="ui-tab-system-live-region"
            aria-live="polite"
            aria-atomic="true"
          />

          <div
            className="ui-tab-system-tabs__scrollable ui-tab-system-tabs__scrollable--sections"
            data-has-stable="true"
          >
            <div
              className="ui-tab-system-tabs__viewport"
              role="tablist"
              aria-label="Right panel tabs"
              aria-orientation="horizontal"
            >
              <div className="ui-tab-system-tabs__section" data-tab-section="workspace">
                <RightPanelHeaderEntryList
                  entries={entries}
                  activeEntryKey={activeEntryKey}
                  unreadByTerminal={unreadByTerminal}
                  isWorkspaceReady={isWorkspaceReady}
                  drag={drag}
                  onActivateTool={onActivateTool}
                  onSelectTerminal={onSelectTerminal}
                  onSelectBrowser={onSelectBrowser}
                  onCloseTerminal={onCloseTerminal}
                  onCloseBrowser={onCloseBrowser}
                  onRenameTerminal={onRenameTerminal}
                />
                <div
                  className="right-panel-tab-drop-target"
                  data-drop-before={drag.showEndDropIndicator ? true : undefined}
                />
              </div>
            </div>
            <div className="ui-tab-system-tabs__spacer" aria-hidden="true" />
          </div>
        </div>

        <RightPanelHeaderActions
          newTabMenuOpen={newTabMenuOpen}
          newTabMenuDefaultKind={newTabMenuDefaultKind}
          isWorkspaceReady={isWorkspaceReady}
          canCreateBrowserTab={canCreateBrowserTab}
          onNewTabMenuOpenChange={setNewTabMenuOpen}
          onCreateTerminal={onCreateTerminal}
          onCreateBrowser={onCreateBrowser}
          onOpenRepoSettings={onOpenRepoSettings}
        />
      </div>
    </div>
  );
}
