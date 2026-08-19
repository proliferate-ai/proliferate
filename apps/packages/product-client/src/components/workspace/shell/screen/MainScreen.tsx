import { memo, useMemo } from "react";
import type { Workspace } from "@anyharness/sdk";
import { CoworkWorkspaceShell } from "#product/components/workspace/cowork/CoworkWorkspaceShell";
import { StandardWorkspaceShell } from "#product/components/workspace/shell/screen/StandardWorkspaceShell";
import { resolveWorkspaceShellSurface } from "#product/lib/domain/workspaces/shell/shell-surface";
import { usePersistedLogicalWorkspaceSelection } from "#product/hooks/workspaces/lifecycle/use-persisted-logical-workspace-selection";
import { useWorkspaces } from "#product/hooks/workspaces/cache/use-workspaces";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useAttendedPendingWorkspaceEntry } from "#product/hooks/workspaces/derived/use-pending-workspace-entries";
import { useHotSessionIngest } from "#product/hooks/sessions/lifecycle/use-hot-session-ingest";
import {
  useStaleFailedPendingWorkspaceGc,
} from "#product/hooks/workspaces/lifecycle/use-stale-failed-pending-workspace-gc";

const EMPTY_WORKSPACES: Workspace[] = [];

// Memoized: the host re-renders on every route/search change (it reads the
// router location), and without a memo boundary every URL change — most
// visibly each Settings section click — re-renders the entire workspace
// shell. `visible` only flips on home <-> elsewhere transitions, so those
// still re-render as before.
export const MainScreen = memo(function MainScreen({ visible = true }: { visible?: boolean }) {
  usePersistedLogicalWorkspaceSelection();
  useHotSessionIngest();
  useStaleFailedPendingWorkspaceGc();
  const pendingWorkspaceEntry = useAttendedPendingWorkspaceEntry();
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
        visible={visible}
        fallbackTitle={pendingWorkspaceEntry?.source === "cowork-created"
          ? pendingWorkspaceEntry.displayName
          : null}
      />
    );
  }

  return <StandardWorkspaceShell visible={visible} />;
});
