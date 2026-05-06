import { useMemo } from "react";
import type { Workspace } from "@anyharness/sdk";
import { CoworkWorkspaceShell } from "@/components/workspace/cowork/CoworkWorkspaceShell";
import { StandardWorkspaceShell } from "@/components/workspace/shell/StandardWorkspaceShell";
import { resolveWorkspaceShellSurface } from "@/lib/domain/workspaces/shell-surface";
import { usePersistedLogicalWorkspaceSelection } from "@/hooks/workspaces/use-persisted-logical-workspace-selection";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useHotSessionIngest } from "@/hooks/sessions/use-hot-session-ingest";

const EMPTY_WORKSPACES: Workspace[] = [];

export function MainScreen() {
  usePersistedLogicalWorkspaceSelection();
  useHotSessionIngest();
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const shellSurface = resolveWorkspaceShellSurface(
    selectedWorkspace,
    pendingWorkspaceEntry,
  );

  if (shellSurface === "cowork") {
    const coworkWorkspace = selectedWorkspace?.surface === "cowork"
      ? selectedWorkspace
      : null;

    return (
      <CoworkWorkspaceShell
        workspaceId={coworkWorkspace?.id ?? null}
        workspacePath={coworkWorkspace?.path ?? null}
        fallbackTitle={pendingWorkspaceEntry?.source === "cowork-created"
          ? pendingWorkspaceEntry.displayName
          : null}
      />
    );
  }

  return <StandardWorkspaceShell />;
}
