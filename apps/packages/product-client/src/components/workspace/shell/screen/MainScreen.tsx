import { useMemo } from "react";
import type { Workspace } from "@anyharness/sdk";
import { CoworkWorkspaceShell } from "#product/components/workspace/cowork/CoworkWorkspaceShell";
import { StandardWorkspaceShell } from "#product/components/workspace/shell/screen/StandardWorkspaceShell";
import { resolveWorkspaceShellSurface } from "#product/lib/domain/workspaces/shell/shell-surface";
import { usePersistedLogicalWorkspaceSelection } from "#product/hooks/workspaces/lifecycle/use-persisted-logical-workspace-selection";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useHotSessionIngest } from "#product/hooks/sessions/lifecycle/use-hot-session-ingest";

const EMPTY_WORKSPACES: Workspace[] = [];

export function MainScreen({ visible = true }: { visible?: boolean }) {
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
        visible={visible}
        fallbackTitle={pendingWorkspaceEntry?.source === "cowork-created"
          ? pendingWorkspaceEntry.displayName
          : null}
      />
    );
  }

  return <StandardWorkspaceShell visible={visible} />;
}
