import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCoworkThreadWorkflow } from "@/hooks/cowork/use-cowork-thread-workflow";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useSessionPromptWorkflow } from "@/hooks/sessions/use-session-prompt-workflow";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/use-workspace-entry-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import type {
  HomeNextAgentOption,
  HomeNextLaunchTarget,
} from "@/lib/domain/home/home-next-launch";
import { useToastStore } from "@/stores/toast/toast-store";

interface HomeNextLaunchInput {
  text: string;
  agent: HomeNextAgentOption;
  target: HomeNextLaunchTarget;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useHomeNextLaunch() {
  const navigate = useNavigate();
  const [isLaunching, setIsLaunching] = useState(false);
  const inFlightRef = useRef(false);
  const showToast = useToastStore((state) => state.show);
  const { createThreadFromSelection } = useCoworkThreadWorkflow();
  const { promptSession } = useSessionPromptWorkflow();
  const { findOrCreateSessionForLaunch } = useSessionActions();
  const { createWorktreeAndEnterWithResult } = useWorkspaceEntryActions();
  const { selectWorkspace } = useWorkspaceSelection();

  const launch = useCallback(async ({
    text,
    agent,
    target,
  }: HomeNextLaunchInput): Promise<boolean> => {
    const prompt = text.trim();
    if (!prompt || !agent.modelId || inFlightRef.current) {
      return false;
    }

    inFlightRef.current = true;
    setIsLaunching(true);

    try {
      if (target.kind === "cowork") {
        const result = await createThreadFromSelection({
          agentKind: agent.kind,
          modelId: agent.modelId,
          draftText: null,
          sourceWorkspaceId: null,
        });
        if (!result) {
          throw new Error("Cowork thread creation was interrupted.");
        }

        await promptSession({
          sessionId: result.session.id,
          text: prompt,
          workspaceId: result.workspace.id,
        });
        return true;
      }

      navigate("/");

      const workspaceId = target.existingWorkspaceId
        ? target.existingWorkspaceId
        : (await createWorktreeAndEnterWithResult({
          repoRootId: target.repository.repoRootId,
          sourceWorkspaceId: target.repository.localWorkspaceId,
          baseBranch: target.branchName,
        }, {
          repoGroupKeyToExpand: target.repository.sourceRoot,
        })).workspaceId;

      if (target.existingWorkspaceId) {
        await selectWorkspace(workspaceId, { force: true });
      }

      await findOrCreateSessionForLaunch({
        workspaceId,
        agentKind: agent.kind,
        modelId: agent.modelId,
        text: prompt,
      });
      return true;
    } catch (error) {
      showToast(`Failed to start work: ${errorMessage(error)}`);
      return false;
    } finally {
      inFlightRef.current = false;
      setIsLaunching(false);
    }
  }, [
    createThreadFromSelection,
    createWorktreeAndEnterWithResult,
    findOrCreateSessionForLaunch,
    navigate,
    promptSession,
    selectWorkspace,
    showToast,
  ]);

  return {
    isLaunching,
    launch,
  };
}
