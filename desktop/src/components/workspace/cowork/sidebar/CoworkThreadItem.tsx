import { useState } from "react";
import type { CoworkThread } from "@anyharness/sdk";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { SessionTitleRenamePopover } from "@/components/workspace/shell/SessionTitleRenamePopover";
import { useCoworkManagedWorkspaces } from "@/hooks/cowork/use-cowork-managed-workspaces";
import { useCoworkSessionActions } from "@/hooks/cowork/use-cowork-session-actions";
import type { SidebarSessionActivityState } from "@/lib/domain/sessions/activity";
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
  activeSessionId: string | null;
  expandedWorkspaceIds: Set<string>;
  onToggleWorkspaceExpanded: (ownershipId: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenSession: (input: { workspaceId: string; sessionId: string }) => void;
}

export function CoworkThreadItem({
  thread,
  active,
  activity,
  expanded,
  onToggleExpanded,
  onSelect,
  selectedWorkspaceId,
  activeSessionId,
  expandedWorkspaceIds,
  onToggleWorkspaceExpanded,
  onOpenWorkspace,
  onOpenSession,
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
          <div className="min-w-0" data-telemetry-mask="true">
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
              setRenaming(true);
            }}
            onArchive={() => {
              close();
              void archiveThread(thread.sessionId, thread.workspaceId);
            }}
          />
        )}
      </PopoverButton>
      {isExpanded && (
        <CoworkManagedWorkspaceList
          workspaces={workspaces}
          isLoading={isLoading}
          parentSessionId={thread.sessionId}
          selectedWorkspaceId={selectedWorkspaceId}
          activeSessionId={activeSessionId}
          expandedWorkspaces={expandedWorkspaceIds}
          onToggleWorkspace={onToggleWorkspaceExpanded}
          onOpenWorkspace={onOpenWorkspace}
          onOpenSession={onOpenSession}
        />
      )}
    </div>
  );
}
