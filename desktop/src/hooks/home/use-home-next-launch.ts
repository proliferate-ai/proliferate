import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateCloudWorkspace } from "@/hooks/cloud/use-create-cloud-workspace";
import { useCoworkThreadWorkflow } from "@/hooks/cowork/use-cowork-thread-workflow";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useSessionPromptWorkflow } from "@/hooks/sessions/use-session-prompt-workflow";
import { useWorkspaceEntryActions } from "@/hooks/workspaces/use-workspace-entry-actions";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import type {
  HomeLaunchTarget,
  HomeNextModelSelection,
} from "@/lib/domain/home/home-next-launch";
import {
  buildDeferredHomeLaunchId,
  useDeferredHomeLaunchStore,
} from "@/stores/home/deferred-home-launch-store";
import { useToastStore } from "@/stores/toast/toast-store";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

interface HomeNextLaunchInput {
  text: string;
  modelSelection: HomeNextModelSelection;
  modeId: string | null;
  target: HomeLaunchTarget;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function modeOptions(modeId: string | null): { modeId?: string } {
  return modeId ? { modeId } : {};
}

export function useHomeNextLaunch() {
  const navigate = useNavigate();
  const [isLaunching, setIsLaunching] = useState(false);
  const inFlightRef = useRef(false);
  const showToast = useToastStore((state) => state.show);
  const enqueueDeferredLaunch = useDeferredHomeLaunchStore((state) => state.enqueue);
  const { createThreadFromSelection } = useCoworkThreadWorkflow();
  const { promptSession } = useSessionPromptWorkflow();
  const { createSessionWithResolvedConfig } = useSessionActions();
  const {
    createLocalWorkspaceAndEnterWithResult,
    createWorktreeAndEnterWithResult,
  } = useWorkspaceEntryActions();
  const { createCloudWorkspaceAndEnterWithResult } = useCreateCloudWorkspace();
  const { selectWorkspace } = useWorkspaceSelection();

  const createFreshSession = useCallback(async (input: {
    workspaceId: string;
    modelSelection: HomeNextModelSelection;
    modeId: string | null;
    text: string;
  }) => {
    await createSessionWithResolvedConfig({
      workspaceId: input.workspaceId,
      agentKind: input.modelSelection.kind,
      modelId: input.modelSelection.modelId,
      text: input.text,
      ...modeOptions(input.modeId),
    });
  }, [createSessionWithResolvedConfig]);

  const launch = useCallback(async ({
    text,
    modelSelection,
    modeId,
    target,
  }: HomeNextLaunchInput): Promise<boolean> => {
    const prompt = text.trim();
    if (!prompt || inFlightRef.current) {
      return false;
    }

    inFlightRef.current = true;
    setIsLaunching(true);

    try {
      if (target.kind === "cowork") {
        const result = await createThreadFromSelection({
          agentKind: modelSelection.kind,
          modelId: modelSelection.modelId,
          modeId,
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

      if (target.kind === "local") {
        const workspaceId = target.existingWorkspaceId
          ? target.existingWorkspaceId
          : (await createLocalWorkspaceAndEnterWithResult(target.sourceRoot, {
            repoGroupKeyToExpand: target.sourceRoot,
          })).workspaceId;
        if (target.existingWorkspaceId) {
          await selectWorkspace(workspaceId, { force: true });
        }
        await createFreshSession({ workspaceId, modelSelection, modeId, text: prompt });
        return true;
      }

      if (target.kind === "worktree") {
        const { workspaceId } = await createWorktreeAndEnterWithResult({
          repoRootId: target.repoRootId,
          sourceWorkspaceId: target.sourceWorkspaceId,
          baseBranch: target.baseBranch,
        });
        await createFreshSession({ workspaceId, modelSelection, modeId, text: prompt });
        return true;
      }

      const latencyFlowId = startLatencyFlow({
        flowKind: "cloud_workspace_create",
        source: "home",
      });
      const result = await createCloudWorkspaceAndEnterWithResult(
        {
          gitOwner: target.gitOwner,
          gitRepoName: target.gitRepoName,
          baseBranch: target.baseBranch,
        },
        { latencyFlowId },
      );
      if (result.status === "interrupted") {
        failLatencyFlow(latencyFlowId, "cloud_workspace_create_interrupted");
        throw new Error("Cloud workspace creation was interrupted.");
      }
      if (result.status === "ready") {
        await createFreshSession({
          workspaceId: result.workspaceId,
          modelSelection,
          modeId,
          text: prompt,
        });
        return true;
      }

      enqueueDeferredLaunch({
        id: buildDeferredHomeLaunchId({
          cloudWorkspaceId: result.cloudWorkspaceId,
          attemptId: result.attemptId,
        }),
        status: "pending",
        workspaceId: result.workspaceId,
        cloudWorkspaceId: result.cloudWorkspaceId,
        cloudAttemptId: result.attemptId,
        agentKind: modelSelection.kind,
        modelId: modelSelection.modelId,
        modeId,
        promptText: prompt,
        createdAt: Date.now(),
      });
      showToast("Prompt queued. It will send when the cloud workspace is ready.", "info");
      return true;
    } catch (error) {
      showToast(`Failed to start work: ${errorMessage(error)}`);
      return false;
    } finally {
      inFlightRef.current = false;
      setIsLaunching(false);
    }
  }, [
    createCloudWorkspaceAndEnterWithResult,
    createFreshSession,
    createLocalWorkspaceAndEnterWithResult,
    createThreadFromSelection,
    createWorktreeAndEnterWithResult,
    enqueueDeferredLaunch,
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
