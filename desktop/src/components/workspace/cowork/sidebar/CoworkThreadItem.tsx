import type { CoworkThread } from "@anyharness/sdk";
import { useCoworkManagedWorkspaces } from "@/hooks/cowork/use-cowork-managed-workspaces";
import type { SessionViewState } from "@/lib/domain/sessions/activity";
import { CoworkManagedWorkspaceList } from "./CoworkManagedWorkspaceList";
import { CoworkThreadRow } from "./CoworkThreadRow";

interface CoworkThreadItemProps {
  thread: CoworkThread;
  active: boolean;
  activity?: SessionViewState;
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

  return (
    <div className="min-w-0">
      <CoworkThreadRow
        thread={thread}
        active={active}
        activity={activity}
        canExpand={canExpand}
        expanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
        onSelect={onSelect}
      />
      {isExpanded && (
        <CoworkManagedWorkspaceList
          workspaces={workspaces}
          isLoading={isLoading}
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
