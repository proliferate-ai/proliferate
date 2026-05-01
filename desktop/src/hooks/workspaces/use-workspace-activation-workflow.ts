import { useCallback } from "react";
import type { SessionActivationOutcome } from "@/hooks/sessions/session-activation-guard";
import {
  type SelectSessionOptionsWithoutGuard,
  useWorkspaceShellActivation,
} from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export type OpenWorkspaceSessionResult =
  | SessionActivationOutcome
  | {
      result: "stale";
      sessionId: string;
      guard: null;
      reason: "navigation-disabled" | "selection-replaced" | "timeout" | "workspace-missing";
    };

export interface OpenWorkspaceSessionInput {
  workspaceId: string;
  sessionId: string;
  forceWorkspaceSelection?: boolean;
  navigateToWorkspace?: boolean;
  selection?: SelectSessionOptionsWithoutGuard;
}

export function useWorkspaceActivationWorkflow() {
  const { selectWorkspace } = useWorkspaceSelection();
  const { activateChatTab } = useWorkspaceShellActivation();

  const openWorkspaceSession = useCallback(async ({
    workspaceId,
    sessionId,
    forceWorkspaceSelection = true,
    navigateToWorkspace = true,
    selection,
  }: OpenWorkspaceSessionInput): Promise<OpenWorkspaceSessionResult> => {
    if (!navigateToWorkspace) {
      return {
        result: "stale",
        sessionId,
        guard: null,
        reason: "navigation-disabled",
      };
    }

    await selectWorkspace(workspaceId, {
      force: forceWorkspaceSelection,
      forceCold: selection?.forceCold,
      latencyFlowId: selection?.latencyFlowId,
    });

    const state = useHarnessStore.getState();
    if (state.selectedWorkspaceId !== workspaceId) {
      return {
        result: "stale",
        sessionId,
        guard: null,
        reason: state.selectedWorkspaceId ? "selection-replaced" : "workspace-missing",
      };
    }

    return await activateChatTab({
      workspaceId,
      sessionId,
      selection,
      source: "workspace-activation-workflow",
    });
  }, [
    activateChatTab,
    selectWorkspace,
  ]);

  return { openWorkspaceSession };
}
