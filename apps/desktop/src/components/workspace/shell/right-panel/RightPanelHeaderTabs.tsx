import {
  useEffect,
  useState,
} from "react";
import { RightPanelHeaderActions } from "@/components/workspace/shell/right-panel/RightPanelHeaderActions";
import { RightPanelHeaderEntryList } from "@/components/workspace/shell/right-panel/RightPanelHeaderEntryList";
import { RightPanelNewTabMenu } from "@/components/workspace/shell/right-panel/RightPanelNewTabMenu";
import { useRightPanelHeaderDrag } from "@/hooks/workspaces/ui/use-right-panel-header-drag";
import {
  type RightPanelHeaderEntryKey,
} from "@/lib/domain/workspaces/shell/right-panel-model";
import type { RightPanelHeaderEntry } from "@/lib/domain/workspaces/shell/right-panel-header-entry";
import type { RightPanelNewTabMenuDefault } from "@/lib/infra/right-panel-new-tab-menu";
import type { FileViewerMode } from "@/lib/domain/workspaces/viewer/viewer-target";
import type { WorkspaceFileBuffer } from "@/stores/editor/workspace-file-buffers-store";
import { useShortcutRevealVisible } from "@/providers/ShortcutRevealProvider";

interface RightPanelHeaderTabsProps {
  entries: readonly RightPanelHeaderEntry[];
  activeEntryKey: RightPanelHeaderEntryKey;
  unreadByTerminal: Record<string, boolean>;
  buffersByPath: Record<string, WorkspaceFileBuffer>;
  tabModes: Record<string, FileViewerMode>;
  isWorkspaceReady: boolean;
  newTabMenuRequestToken: number;
  newTabMenuDefaultKind: RightPanelNewTabMenuDefault;
  onActivateEntry: (entryKey: RightPanelHeaderEntryKey) => boolean;
  onCloseTerminal: (terminalId: string) => void;
  onCloseViewerTarget: (targetKey: RightPanelHeaderEntryKey) => void;
  onRenameTerminal: (terminalId: string, title: string) => Promise<void>;
  onCreateTerminal: () => void;
  onOpenRepoSettings: () => void;
  onTogglePanel: () => void;
  onReorderHeaderEntry: (
    entryKey: RightPanelHeaderEntryKey,
    beforeEntryKey: RightPanelHeaderEntryKey | null,
  ) => void;
}

export function RightPanelHeaderTabs({
  entries,
  activeEntryKey,
  unreadByTerminal,
  buffersByPath,
  tabModes,
  isWorkspaceReady,
  newTabMenuRequestToken,
  newTabMenuDefaultKind,
  onActivateEntry,
  onCloseTerminal,
  onCloseViewerTarget,
  onRenameTerminal,
  onCreateTerminal,
  onOpenRepoSettings,
  onTogglePanel,
  onReorderHeaderEntry,
}: RightPanelHeaderTabsProps) {
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  const drag = useRightPanelHeaderDrag({
    onActivateHeaderEntry: onActivateEntry,
    onReorderHeaderEntry,
  });
  const shortcutRevealVisible = useShortcutRevealVisible();

  useEffect(() => {
    if (newTabMenuRequestToken > 0) {
      setNewTabMenuOpen(true);
    }
  }, [newTabMenuRequestToken]);

  return (
    <div className="right-panel-tab-system ui-tab-system editor-panel-tab-root editor-panel-tab-root--simple-tabs">
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
            <div className="ui-tab-system-tabs__edge ui-tab-system-tabs__edge--start" aria-hidden="true" />
            <span aria-hidden="true" />
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
                  buffersByPath={buffersByPath}
                  tabModes={tabModes}
                  isWorkspaceReady={isWorkspaceReady}
                  drag={drag}
                  shortcutRevealVisible={shortcutRevealVisible}
                  onActivateEntry={onActivateEntry}
                  onCloseTerminal={onCloseTerminal}
                  onCloseViewerTarget={onCloseViewerTarget}
                  onRenameTerminal={onRenameTerminal}
                />
                <div
                  className="right-panel-tab-drop-target"
                  data-drop-before={drag.showEndDropIndicator ? true : undefined}
                />
              </div>
            </div>
            <span aria-hidden="true" />
            <div className="ui-tab-system-tabs__spacer" aria-hidden="true" />
            <div className="ui-tab-system-tabs__edge ui-tab-system-tabs__edge--end" aria-hidden="true" />
          </div>
          <div className="ui-tab-system-new-tab-sticky">
            <RightPanelNewTabMenu
              open={newTabMenuOpen}
              defaultKind={newTabMenuDefaultKind}
              isWorkspaceReady={isWorkspaceReady}
              onOpenChange={setNewTabMenuOpen}
              onCreateTerminal={onCreateTerminal}
            />
          </div>
        </div>

        <RightPanelHeaderActions
          onOpenRepoSettings={onOpenRepoSettings}
          onTogglePanel={onTogglePanel}
          shortcutRevealVisible={shortcutRevealVisible}
        />
      </div>
    </div>
  );
}
