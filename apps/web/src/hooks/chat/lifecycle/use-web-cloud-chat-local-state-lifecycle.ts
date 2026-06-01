import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { CloudSessionProjection } from "@proliferate/cloud-sdk";
import {
  buildLaunchSessionConfigUpdates,
  resolveCloudLaunchSelection,
  type CloudLaunchComposerSelection,
  type PendingConfigChange,
} from "@proliferate/product-domain/chats/cloud/composer-controls";

import { routes } from "../../../config/routes";
import {
  sessionDraftMatchesSelection,
} from "../../../lib/domain/chat/cloud-chat-session-model";
import {
  loadPendingHomePrompt,
  type PendingHomePrompt,
} from "../../../lib/access/cloud/pending-home-prompt-store";
import {
  clearWebCloudSessionDraft,
  loadWebCloudPendingConfigChanges,
  loadWebCloudPromptIntents,
  loadWebCloudSessionDraftFromSearch,
  saveWebCloudPendingConfigChanges,
  saveWebCloudPromptIntents,
  saveWebCloudSessionDraft,
  type WebCloudPromptIntent,
  type WebCloudSessionDraft,
} from "../../../stores/cloud/web-cloud-chat-state-store";

export type PendingHomePromptDispatchRun = {
  key: string;
  active: boolean;
  started: boolean;
};

export function useWebCloudChatLocalStateLifecycle(input: {
  workspaceId: string | undefined;
  chatId: string | undefined;
  locationSearch: string;
  routeSessionDraftId: string | null;
  pendingSessionDraft: WebCloudSessionDraft | null;
  setPendingSessionDraft: Dispatch<SetStateAction<WebCloudSessionDraft | null>>;
  pendingHomePrompt: PendingHomePrompt | null;
  setPendingHomePrompt: Dispatch<SetStateAction<PendingHomePrompt | null>>;
  setPendingHomePromptStatus: Dispatch<SetStateAction<string | null>>;
  optimisticPrompts: readonly WebCloudPromptIntent[];
  setOptimisticPrompts: Dispatch<SetStateAction<WebCloudPromptIntent[]>>;
  pendingConfigChanges: Record<string, PendingConfigChange>;
  setPendingConfigChanges: Dispatch<SetStateAction<Record<string, PendingConfigChange>>>;
  pendingHomePromptDispatchRunRef: { current: PendingHomePromptDispatchRun | null };
  pendingHomePromptResumeAttemptsRef: { current: Set<string> };
  mountedRef: { current: boolean };
  setLaunchSelection: Dispatch<SetStateAction<CloudLaunchComposerSelection>>;
  launchSelection: CloudLaunchComposerSelection;
  canStartNewSession: boolean;
  launchCatalog: Parameters<typeof resolveCloudLaunchSelection>[0]["catalog"];
  workspaceLaunchableAgentKinds: readonly string[];
  workspace: { id: string } | null;
  workspaceStatus: string | null;
  workspaceRefetch: () => void;
  directPromptDispatching: boolean;
  suppressSessionRedirect: boolean;
  sessions: readonly CloudSessionProjection[];
  navigate: NavigateFunction;
}) {
  const {
    workspaceId,
    chatId,
    locationSearch,
    routeSessionDraftId,
    pendingSessionDraft,
    setPendingSessionDraft,
    pendingHomePrompt,
    setPendingHomePrompt,
    setPendingHomePromptStatus,
    optimisticPrompts,
    setOptimisticPrompts,
    pendingConfigChanges,
    setPendingConfigChanges,
    pendingHomePromptDispatchRunRef,
    pendingHomePromptResumeAttemptsRef,
    mountedRef,
    setLaunchSelection,
    launchSelection,
    canStartNewSession,
    launchCatalog,
    workspaceLaunchableAgentKinds,
    workspace,
    workspaceStatus,
    workspaceRefetch,
    directPromptDispatching,
    suppressSessionRedirect,
    sessions,
    navigate,
  } = input;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pendingHomePromptDispatchRunRef.current) {
        pendingHomePromptDispatchRunRef.current.active = false;
      }
    };
  }, [mountedRef, pendingHomePromptDispatchRunRef]);

  useEffect(() => {
    setPendingHomePrompt(workspaceId ? loadPendingHomePrompt(workspaceId) : null);
    setPendingHomePromptStatus(null);
    setOptimisticPrompts(workspaceId ? loadWebCloudPromptIntents(workspaceId) : []);
    setPendingConfigChanges(workspaceId ? loadWebCloudPendingConfigChanges(workspaceId) : {});
    pendingHomePromptResumeAttemptsRef.current.clear();
  }, [
    pendingHomePromptResumeAttemptsRef,
    setOptimisticPrompts,
    setPendingConfigChanges,
    setPendingHomePrompt,
    setPendingHomePromptStatus,
    workspaceId,
  ]);

  useEffect(() => {
    setPendingSessionDraft(
      workspaceId ? loadWebCloudSessionDraftFromSearch(workspaceId, locationSearch) : null,
    );
  }, [locationSearch, setPendingSessionDraft, workspaceId]);

  useEffect(() => {
    if (!workspaceId || optimisticPrompts.some((prompt) => prompt.workspaceId !== workspaceId)) {
      return;
    }
    saveWebCloudPromptIntents(workspaceId, optimisticPrompts);
  }, [optimisticPrompts, workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    saveWebCloudPendingConfigChanges(workspaceId, pendingConfigChanges);
  }, [pendingConfigChanges, workspaceId]);

  useEffect(() => {
    if (!pendingSessionDraft) {
      return;
    }
    setLaunchSelection(pendingSessionDraft.selection);
  }, [pendingSessionDraft?.id, pendingSessionDraft, setLaunchSelection]);

  useEffect(() => {
    if (!workspaceId || !routeSessionDraftId || pendingSessionDraft) {
      return;
    }
    clearWebCloudSessionDraft(workspaceId, routeSessionDraftId);
    navigate(routes.workspace(workspaceId), { replace: true });
  }, [navigate, pendingSessionDraft, routeSessionDraftId, workspaceId]);

  useEffect(() => {
    if (!pendingSessionDraft) {
      return;
    }
    if (!canStartNewSession) {
      return;
    }
    const resolvedSelection = resolveCloudLaunchSelection({
      catalog: launchCatalog,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection: launchSelection,
    });
    const sessionConfigUpdates = buildLaunchSessionConfigUpdates({
      catalog: launchCatalog,
      launchableAgentKinds: workspaceLaunchableAgentKinds,
      selection: resolvedSelection,
    });
    if (sessionDraftMatchesSelection(pendingSessionDraft, resolvedSelection, sessionConfigUpdates)) {
      return;
    }
    const nextDraft = {
      ...pendingSessionDraft,
      selection: resolvedSelection,
      sessionConfigUpdates,
    };
    saveWebCloudSessionDraft(nextDraft);
    setPendingSessionDraft(nextDraft);
  }, [
    launchCatalog,
    launchSelection,
    pendingSessionDraft?.id,
    pendingSessionDraft?.workspaceId,
    pendingSessionDraft,
    canStartNewSession,
    setPendingSessionDraft,
    workspaceLaunchableAgentKinds,
  ]);

  useEffect(() => {
    if (!workspaceId || !workspace || workspaceStatus === "ready" || workspaceStatus === "error") {
      return;
    }
    const interval = window.setInterval(() => {
      void workspaceRefetch();
    }, 2500);
    return () => {
      window.clearInterval(interval);
    };
  }, [workspace, workspaceStatus, workspaceId, workspaceRefetch]);

  useEffect(() => {
    if (
      !workspaceId
      || chatId
      || pendingHomePrompt
      || directPromptDispatching
      || suppressSessionRedirect
    ) {
      return;
    }
    const latestSession = sessions[0];
    if (!latestSession) {
      return;
    }
    navigate(routes.chat(workspaceId, latestSession.sessionId), { replace: true });
  }, [
    chatId,
    directPromptDispatching,
    navigate,
    pendingHomePrompt,
    sessions,
    suppressSessionRedirect,
    workspaceId,
  ]);
}
