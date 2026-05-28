import { useRef, useState } from "react";
import type {
  AgentAuthAgentKind,
  CloudAgentCatalogResponse,
} from "@proliferate/cloud-sdk";
import {
  useCloudClient,
  useCreateCloudWorkspace,
  useLaunchCloudWorkspaceOnTarget,
} from "@proliferate/cloud-sdk-react";
import type { CloudLaunchComposerSelection } from "@proliferate/product-model/chats/cloud/composer-controls";

import {
  buildBranchName,
  buildMobilePendingPrompt,
  buildWorkspaceDisplayName,
  type MobileRepoOption,
  type MobileRuntimeOption,
} from "../../../lib/domain/home/mobile-home-launch";
import { savePendingMobilePrompt } from "../../../lib/access/cloud/pending-mobile-prompt-store";
import { ensurePersonalAgentAuthLaunchReady } from "../../../lib/access/cloud/agent-auth-launch-readiness";
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
  const client = useCloudClient();
  const createWorkspace = useCreateCloudWorkspace();
  const launchOnTarget = useLaunchCloudWorkspaceOnTarget();

  async function submit(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt || !input.selectedRepo || !input.selectedRuntime || submitInFlightRef.current) {
      return;
    }
    if (!input.ownerUserId) {
      setError("Account is still loading. Try again in a moment.");
      return;
    }
    if (input.selectedRuntime.kind === "target" && !input.selectedRuntime.online) {
      setError(`${input.selectedRuntime.label} is offline.`);
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
      if (input.selectedRuntime.kind === "target") {
        setStatus("Dispatching to target.");
        const result = await launchOnTarget.mutateAsync({
          targetId: input.selectedRuntime.targetId,
          gitProvider: "github",
          gitOwner: input.selectedRepo.gitOwner,
          gitRepoName: input.selectedRepo.gitRepoName,
          baseBranch: input.selectedBaseBranch,
          branchName: buildBranchName(prompt),
          displayName: buildWorkspaceDisplayName(prompt),
          prompt,
          promptId: pendingPrompt.id,
          agentKind: input.selection.agentKind,
          modelId: input.selection.modelId,
          modeId: input.selection.modeId,
          sessionConfigUpdates: pendingPrompt.sessionConfigUpdates,
          source: "mobile",
        });
        input.onSubmitted?.();
        input.onOpenChat({
          workspaceId: result.workspace.id,
          workspaceName: result.workspace.displayName ?? result.workspace.repo.name,
          repoLabel: `${result.workspace.repo.owner}/${result.workspace.repo.name}`,
          branchLabel: result.workspace.repo.branch ?? result.workspace.repo.baseBranch ?? "main",
          targetId: result.workspace.targetId ?? input.selectedRuntime.targetId,
          workspaceRuntimeId: result.workspace.anyharnessWorkspaceId ?? null,
          sessionId: result.sessionId,
          title: result.workspace.displayName ?? result.workspace.repo.name,
          status: result.workspace.workspaceStatus ?? result.workspace.status,
          visibility: result.workspace.visibility,
        });
        setStatus(null);
        return;
      }

      setStatus("Creating cloud workspace.");
      await ensurePersonalAgentAuthLaunchReady({
        client,
        agentKind: normalizeAgentAuthAgentKind(input.selection.agentKind),
        modelId: input.selection.modelId,
        onStatus: setStatus,
      });
      setStatus("Creating cloud workspace.");
      const workspace = await createWorkspace.mutateAsync({
        gitProvider: "github",
        gitOwner: input.selectedRepo.gitOwner,
        gitRepoName: input.selectedRepo.gitRepoName,
        baseBranch: input.selectedBaseBranch,
        branchName: buildBranchName(prompt),
        displayName: buildWorkspaceDisplayName(prompt),
        ownerScope: "personal",
        requiredAgentKind: input.selection.agentKind,
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
    submitting:
      createWorkspace.isPending ||
      launchOnTarget.isPending ||
      submitInFlightRef.current,
  };
}

function normalizeAgentAuthAgentKind(agentKind: string): AgentAuthAgentKind | null {
  switch (agentKind) {
    case "claude":
    case "codex":
    case "opencode":
    case "gemini":
      return agentKind;
    default:
      return null;
  }
}
