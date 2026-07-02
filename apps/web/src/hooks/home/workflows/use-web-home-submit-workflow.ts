import { useRef, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import type { CreateCloudWorkspaceRequest } from "@proliferate/cloud-sdk";
import {
  useCloudClient,
  useCreateCloudWorkspace,
} from "@proliferate/cloud-sdk-react";
import {
  buildLaunchSessionConfigUpdates,
  type CloudLaunchComposerSelection,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import { routes } from "../../../config/routes";
import { createCloudWorkspaceWithTransientRecovery } from "../../../lib/access/cloud/create-workspace-with-transient-recovery";
import { savePendingHomePrompt } from "../../../lib/access/cloud/pending-home-prompt-store";
import {
  buildBranchName,
  buildWorkspaceDisplayName,
  type RepoOption,
  type RuntimeOption,
} from "../../../lib/domain/home/cloud-home-launch-model";
import type { HomePendingPrompt } from "../../../lib/domain/home/cloud-home-pending-prompt";

export function useWebHomeSubmitWorkflow(input: {
  draft: string;
  selectedRepo: RepoOption | null;
  selectedRuntime: RuntimeOption | null;
  selectedBaseBranch: string | null;
  canStartCloudHarness: boolean;
  harnessMessage: string | null | undefined;
  agentCatalog: Parameters<typeof buildLaunchSessionConfigUpdates>[0]["catalog"];
  launchableAgentKinds: readonly string[];
  resolvedLaunchSelection: CloudLaunchComposerSelection;
  setDraft: Dispatch<SetStateAction<string>>;
  setSubmitError: Dispatch<SetStateAction<string | null>>;
  setPendingPrompt: Dispatch<SetStateAction<HomePendingPrompt | null>>;
}) {
  const navigate = useNavigate();
  const client = useCloudClient();
  const createWorkspace = useCreateCloudWorkspace();
  const submitInFlightRef = useRef(false);
  const submitting = createWorkspace.isPending || submitInFlightRef.current;

  async function handleSubmit() {
    const text = input.draft.trim();
    if (!text || !input.selectedRepo || submitInFlightRef.current) return;
    if (!input.selectedRuntime) {
      input.setSubmitError("Select a runtime before sending.");
      return;
    }
    if (!input.canStartCloudHarness) {
      input.setSubmitError(
        input.harnessMessage ?? "No cloud agent is ready to start this workspace.",
      );
      return;
    }

    submitInFlightRef.current = true;
    input.setSubmitError(null);
    const pendingPrompt = {
      id: `web-home:${Date.now().toString(36)}`,
      text,
      status: "creating" as const,
    };
    input.setPendingPrompt(pendingPrompt);
    input.setDraft("");
    try {
      await waitForNextPaint();
      const sessionConfigUpdates = buildLaunchSessionConfigUpdates({
        catalog: input.agentCatalog,
        launchableAgentKinds: input.launchableAgentKinds,
        selection: input.resolvedLaunchSelection,
      });
      const workspacePendingPrompt = {
        id: pendingPrompt.id,
        text,
        agentKind: input.resolvedLaunchSelection.agentKind,
        modelId: input.resolvedLaunchSelection.modelId,
        modeId: input.resolvedLaunchSelection.modeId,
        sessionConfigUpdates,
        createdAt: Date.now(),
      };
      const workspaceRequest: CreateCloudWorkspaceRequest = {
        gitProvider: "github",
        gitOwner: input.selectedRepo.gitOwner,
        gitRepoName: input.selectedRepo.gitRepoName,
        baseBranch: input.selectedBaseBranch,
        branchName: buildBranchName(text),
        generatedName: true,
        displayName: buildWorkspaceDisplayName(text),
        source: "web",
      };
      const workspace = await createCloudWorkspaceWithTransientRecovery({
        client,
        request: workspaceRequest,
        createWorkspace: createWorkspace.mutateAsync,
      });
      savePendingHomePrompt(workspace.id, workspacePendingPrompt);
      navigate(routes.workspace(workspace.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create workspace.";
      input.setSubmitError(message);
      input.setPendingPrompt({
        ...pendingPrompt,
        status: "failed",
        detail: message,
      });
    } finally {
      submitInFlightRef.current = false;
    }
  }

  return {
    submitting,
    handleSubmit,
  };
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}
