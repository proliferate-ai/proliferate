import { useRef, useState } from "react";
import type {
  CloudAgentCatalogResponse,
} from "@proliferate/cloud-sdk";
import {
  useCreateCloudWorkspace,
} from "@proliferate/cloud-sdk-react";
import type { CloudLaunchComposerSelection } from "@proliferate/product-domain/chats/cloud/composer-controls";

import {
  buildBranchName,
  buildMobilePendingPrompt,
  buildWorkspaceDisplayName,
  type MobileRepoOption,
  type MobileRuntimeOption,
} from "../../../lib/domain/home/mobile-home-launch";
import { savePendingMobilePrompt } from "../../../lib/access/cloud/pending-mobile-prompt-store";
import type { MobileCloudChat } from "../../../navigation/navigation-model";

export function useMobileHomeLaunchActions(input: {
  ownerUserId: string | null;
  catalog?: CloudAgentCatalogResponse | null;
  launchableAgentKinds?: readonly string[] | null;
  selectedRepo: MobileRepoOption | null;
  selectedBaseBranch: string | null;
  selectedRuntime: MobileRuntimeOption | null;
  selection: CloudLaunchComposerSelection;
  onOpenChat: (chat: MobileCloudChat) => void;
  onSubmitted?: () => void;
}) {
  const submitInFlightRef = useRef(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createWorkspace = useCreateCloudWorkspace();

  async function submit(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt || !input.selectedRepo || !input.selectedRuntime || submitInFlightRef.current) {
      return;
    }
    if (!input.ownerUserId) {
      setError("Account is still loading. Try again in a moment.");
      return;
    }

    submitInFlightRef.current = true;
    setError(null);
    const pendingPrompt = buildMobilePendingPrompt({
      text: prompt,
      selection: input.selection,
      catalog: input.catalog,
      launchableAgentKinds: input.launchableAgentKinds,
      repo: input.selectedRepo,
      runtime: input.selectedRuntime,
    });

    try {
      setStatus("Creating cloud workspace.");
      const workspace = await createWorkspace.mutateAsync({
        gitProvider: "github",
        gitOwner: input.selectedRepo.gitOwner,
        gitRepoName: input.selectedRepo.gitRepoName,
        baseBranch: input.selectedBaseBranch,
        branchName: buildBranchName(prompt),
        generatedName: true,
        displayName: buildWorkspaceDisplayName(prompt),
        source: "mobile",
      });
      await savePendingMobilePrompt(workspace.id, input.ownerUserId, pendingPrompt)
        .catch(() => undefined);
      input.onSubmitted?.();
      input.onOpenChat({
        workspaceId: workspace.id,
        workspaceName: workspace.displayName ?? workspace.repo.name,
        repoLabel: `${workspace.repo.owner}/${workspace.repo.name}`,
        branchLabel: workspace.repo.branch ?? workspace.repo.baseBranch ?? "main",
        targetId: workspace.targetId ?? null,
        workspaceRuntimeId: workspace.anyharnessWorkspaceId ?? null,
        sessionId: null,
        title: workspace.displayName ?? workspace.repo.name,
        status: workspace.workspaceStatus ?? workspace.status,
        visibility: workspace.visibility,
        initialPendingPrompt: pendingPrompt,
      });
      setStatus(null);
    } catch (launchError) {
      setStatus(null);
      setError(launchError instanceof Error ? launchError.message : "Could not start this chat.");
    } finally {
      submitInFlightRef.current = false;
    }
  }

  return {
    error,
    status,
    submit,
    submitting: createWorkspace.isPending || submitInFlightRef.current,
  };
}
