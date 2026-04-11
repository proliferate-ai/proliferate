import type { Workspace } from "@anyharness/sdk";
import { useMemo } from "react";
import { useCoworkWorkspaces } from "@/hooks/cowork/use-cowork-workspaces";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useHarnessStore } from "@/stores/sessions/harness-store";

const EMPTY_WORKSPACES: Workspace[] = [];

export function useSelectedWorkspace() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { data: workspaceCollections } = useWorkspaces();
  const { data: coworkWorkspaces } = useCoworkWorkspaces();
  const codeWorkspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;

  return useMemo(() => {
    if (!selectedWorkspaceId) {
      return {
        selectedWorkspace: null,
        workspaceSurfaceKind: null,
        isCoworkWorkspaceSelected: false,
      } as const;
    }

    const selectedWorkspace =
      coworkWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId)
      ?? codeWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId)
      ?? null;

    return {
      selectedWorkspace,
      workspaceSurfaceKind: selectedWorkspace?.surfaceKind ?? null,
      isCoworkWorkspaceSelected: selectedWorkspace?.surfaceKind === "cowork",
    } as const;
  }, [codeWorkspaces, coworkWorkspaces, selectedWorkspaceId]);
}
