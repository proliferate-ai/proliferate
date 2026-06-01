import type { Dispatch, SetStateAction } from "react";
import type { CloudWorkspaceDetail } from "@proliferate/cloud-sdk";

export function useWebCloudWorkspaceActions(input: {
  workspace: CloudWorkspaceDetail | null;
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  workspaceRefetch: () => Promise<unknown> | unknown;
  claimWorkspace: {
    isPending: boolean;
    mutateAsync: (input: { workspaceId: string }) => Promise<unknown>;
  };
}) {
  const {
    workspace,
    setPendingHomePromptStatus,
    workspaceRefetch,
    claimWorkspace,
  } = input;

  async function claimCurrentWorkspace() {
    if (!workspace || claimWorkspace.isPending) {
      return;
    }
    setPendingHomePromptStatus("Claiming workspace.");
    try {
      await claimWorkspace.mutateAsync({ workspaceId: workspace.id });
      await workspaceRefetch();
      setPendingHomePromptStatus("Workspace claimed.");
    } catch (error) {
      setPendingHomePromptStatus(
        error instanceof Error ? error.message : "Workspace could not be claimed.",
      );
    }
  }

  async function copyComposerFooterValue(value: string, label: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      console.warn(`${label} could not be copied.`);
      return false;
    }
  }

  return {
    claimCurrentWorkspace,
    copyComposerFooterValue,
  };
}
