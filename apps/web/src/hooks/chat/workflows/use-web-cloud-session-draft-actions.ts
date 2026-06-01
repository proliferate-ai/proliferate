import type { Dispatch, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { CloudWorkspaceDetail } from "@proliferate/cloud-sdk";
import {
  buildLaunchSessionConfigUpdates,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import { routes } from "../../../config/routes";
import {
  clearWebCloudSessionDraft,
  createWebCloudSessionDraft,
  saveWebCloudSessionDraft,
  webCloudSessionDraftSearch,
  type WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-chat-state-store";

export function useWebCloudSessionDraftActions(input: {
  workspace: CloudWorkspaceDetail | null;
  canStartNewSession: boolean;
  workspaceHarnessAvailability: { message?: string | null };
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  setPendingSessionDraft: Dispatch<SetStateAction<WebCloudSessionDraft | null>>;
  pendingSessionDraft: WebCloudSessionDraft | null;
  setPendingConfigChanges: Dispatch<SetStateAction<Record<string, PendingConfigChange>>>;
  setLaunchSelection: Dispatch<SetStateAction<CloudLaunchComposerSelection>>;
  agentCatalog: Parameters<typeof resolveCloudLaunchSelection>[0]["catalog"];
  workspaceLaunchableAgentKinds: readonly string[];
  resolvedLaunchSelection: CloudLaunchComposerSelection;
  navigate: NavigateFunction;
}) {
  const {
    workspace,
    canStartNewSession,
    workspaceHarnessAvailability,
    setPendingHomePromptStatus,
    setPendingSessionDraft,
    pendingSessionDraft,
    setPendingConfigChanges,
    setLaunchSelection,
    agentCatalog,
    workspaceLaunchableAgentKinds,
    resolvedLaunchSelection,
    navigate,
  } = input;

  function openNewSessionDraft(selection: CloudLaunchComposerSelection = resolvedLaunchSelection) {
    if (!workspace) {
      return;
    }
    if (!canStartNewSession) {
      setPendingHomePromptStatus(
        workspaceHarnessAvailability.message
          ?? "No cloud agent is ready to start a new session in this workspace.",
      );
      return;
    }
    if (pendingSessionDraft) {
      clearWebCloudSessionDraft(workspace.id, pendingSessionDraft.id);
    }
    const resolvedSelection = resolveCloudLaunchSelection({
      catalog: agentCatalog,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection,
    });
    const draft = createWebCloudSessionDraft({
      workspaceId: workspace.id,
      selection: resolvedSelection,
      sessionConfigUpdates: buildLaunchSessionConfigUpdates({
        catalog: agentCatalog,
        launchableAgentKinds: workspaceLaunchableAgentKinds,
        selection: resolvedSelection,
      }),
    });
    saveWebCloudSessionDraft(draft);
    setPendingSessionDraft(draft);
    setLaunchSelection(resolvedSelection);
    setPendingConfigChanges({});
    setPendingHomePromptStatus(null);
    navigate(`${routes.workspace(workspace.id)}${webCloudSessionDraftSearch(draft.id)}`);
  }

  return { openNewSessionDraft };
}
