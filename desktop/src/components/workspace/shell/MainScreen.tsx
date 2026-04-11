import { useMemo } from "react";
import type { Workspace } from "@anyharness/sdk";
import { CoworkWorkspaceShell } from "@/components/workspace/cowork/CoworkWorkspaceShell";
import { StandardWorkspaceShell } from "@/components/workspace/shell/StandardWorkspaceShell";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useHarnessStore } from "@/stores/sessions/harness-store";

const EMPTY_WORKSPACES: Workspace[] = [];

export function MainScreen() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId),
    [selectedWorkspaceId, workspaces],
  );

  if (selectedWorkspace?.surface === "cowork") {
    return <CoworkWorkspaceShell workspace={selectedWorkspace} />;
  }

  return <StandardWorkspaceShell />;
}
