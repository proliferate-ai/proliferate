import { useState } from "react";
import type { CoworkThread } from "@anyharness/sdk";
import { PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { SessionTitleRenamePopover } from "@/components/workspace/shell/tabs/SessionTitleRenamePopover";
import { useCoworkManagedWorkspaces } from "@/hooks/access/anyharness/cowork/use-cowork-managed-workspaces";
import { useCoworkSessionNativeContextMenu } from "@/hooks/cowork/ui/use-cowork-session-native-context-menu";
import { useCoworkSessionActions } from "@/hooks/cowork/workflows/use-cowork-session-actions";
import type { SidebarSessionActivityState } from "@proliferate/product-domain/sessions/activity";
import { coworkThreadTitle } from "@/lib/domain/cowork/threads";
import { CoworkManagedWorkspaceList } from "./CoworkManagedWorkspaceList";
import { CoworkSessionActionsMenu } from "./CoworkSessionActionsMenu";
import { CoworkThreadRow } from "./CoworkThreadRow";

interface CoworkThreadItemProps {
  thread: CoworkThread;
  active: boolean;
  activity?: SidebarSessionActivityState;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSelect: () => void;
  selectedWorkspaceId: string | null;
  onOpenWorkspace: (workspaceId: string) => void;
}

export function CoworkThreadItem({
  thread,
  active,
  activity,
  expanded,
  onToggleExpanded,
  onSelect,
  selectedWorkspaceId,
  onOpenWorkspace,
}: CoworkThreadItemProps) {
  const { workspaces, isLoading } = useCoworkManagedWorkspaces(
    thread.sessionId,
    thread.workspaceDelegationEnabled,
  );
  const hasManagedWorkspaces = workspaces.length > 0;
  const canExpand = thread.workspaceDelegationEnabled && hasManagedWorkspaces;
  const isExpanded = canExpand && expanded;

  const [renaming, setRenaming] = useState(false);
  const { renameThread, archiveThread } = useCoworkSessionActions();

  const currentTitle = coworkThreadTitle(thread);
  const handleRename = () => setRenaming(true);
  const handleArchive = () => {
    void archiveThread(thread.sessionId, thread.workspaceId);
  };
  const { onContextMenuCapture } = useCoworkSessionNativeContextMenu({
    onRename: handleRename,
    onArchive: handleArchive,
  });

  const row = (
    <CoworkThreadRow
      thread={thread}
      active={active}
      activity={activity}
      canExpand={canExpand}
      expanded={isExpanded}
      onToggleExpanded={onToggleExpanded}
      onSelect={onSelect}
    />
  );

  return (
    <div className="min-w-0">
      <PopoverButton
        triggerMode="contextMenu"
        className="w-44 rounded-lg border border-border bg-popover p-1 shadow-floating"
        trigger={
          <div className="min-w-0" data-telemetry-mask="true" onContextMenuCapture={onContextMenuCapture}>
            <SessionTitleRenamePopover
              currentTitle={currentTitle}
              trigger={<div className="min-w-0">{row}</div>}
              triggerMode="doubleClick"
              externalOpen={renaming}
              onOpenChange={setRenaming}
              onRename={(title) => renameThread(thread.sessionId, thread.workspaceId, title)}
            />
          </div>
        }
      >
        {(close) => (
          <CoworkSessionActionsMenu
            onRename={() => {
              close();
              handleRename();
            }}
            onArchive={() => {
              close();
              handleArchive();
            }}
          />
        )}
      </PopoverButton>
      {isExpanded && (
        <CoworkManagedWorkspaceList
          workspaces={workspaces}
          isLoading={isLoading}
          selectedWorkspaceId={selectedWorkspaceId}
          onOpenWorkspace={onOpenWorkspace}
        />
      )}
    </div>
  );
}
