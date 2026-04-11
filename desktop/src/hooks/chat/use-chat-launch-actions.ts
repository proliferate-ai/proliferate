import { useCallback } from "react";
import type { ModelSelectorSelection } from "@/lib/domain/chat/model-selection";
import type { Workspace } from "@anyharness/sdk";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useCoworkThreadWorkflow } from "@/hooks/cowork/use-cowork-thread-workflow";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useActiveChatSessionState } from "./use-active-chat-session-state";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

const EMPTY_WORKSPACES: Workspace[] = [];

export function useChatLaunchActions() {
  const showToast = useToastStore((store) => store.show);
  const setWorkspaceArrivalEvent = useHarnessStore((state) => state.setWorkspaceArrivalEvent);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const currentDraft = useChatInputStore((state) =>
    selectedWorkspaceId ? state.draftByWorkspaceId[selectedWorkspaceId] ?? "" : "",
  );
  const { data: workspaceCollections } = useWorkspaces();
  const workspaces = workspaceCollections?.workspaces ?? EMPTY_WORKSPACES;
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const { openWorkspaceSessionWithResolvedConfig, setActiveSessionConfigOption } = useSessionActions();
  const { createThreadFromSelection } = useCoworkThreadWorkflow();
  const {
    activeSessionId,
    currentLaunchIdentity,
    currentModelConfigId,
  } = useActiveChatSessionState();

  const handleLaunchSelect = useCallback((selection: ModelSelectorSelection) => {
    if (
      currentLaunchIdentity?.kind === selection.kind
      && currentLaunchIdentity.modelId === selection.modelId
    ) {
      return;
    }

    if (
      activeSessionId
      && currentLaunchIdentity?.kind === selection.kind
      && currentModelConfigId
    ) {
      void setActiveSessionConfigOption(currentModelConfigId, selection.modelId)
        .then(() => {
          setWorkspaceArrivalEvent(null);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          showToast(`Failed to switch model: ${message}`);
      });
      return;
    }

    if (selectedWorkspace?.surface === "cowork") {
      const latencyFlowId = startLatencyFlow({
        flowKind: "session_create",
        source: "model_selector",
        targetWorkspaceId: selectedWorkspaceId,
      });
      void createThreadFromSelection({
        agentKind: selection.kind,
        modelId: selection.modelId,
        draftText: currentDraft,
        sourceWorkspaceId: selectedWorkspaceId,
      })
        .then(() => {
          setWorkspaceArrivalEvent(null);
        })
        .catch((error) => {
          failLatencyFlow(latencyFlowId, "session_create_failed");
          const message = error instanceof Error ? error.message : String(error);
          showToast(`Failed to open chat: ${message}`);
        });
      return;
    }

    const latencyFlowId = startLatencyFlow({
      flowKind: "session_create",
      source: "model_selector",
      targetWorkspaceId: selectedWorkspaceId,
    });
    void openWorkspaceSessionWithResolvedConfig({
      agentKind: selection.kind,
      modelId: selection.modelId,
      latencyFlowId,
    })
      .then(() => {
        setWorkspaceArrivalEvent(null);
      })
      .catch((error) => {
        failLatencyFlow(latencyFlowId, "session_create_failed");
        const message = error instanceof Error ? error.message : String(error);
        showToast(`Failed to open chat: ${message}`);
      });
  }, [
    activeSessionId,
    currentLaunchIdentity,
    createThreadFromSelection,
    currentDraft,
    currentModelConfigId,
    openWorkspaceSessionWithResolvedConfig,
    selectedWorkspace?.surface,
    selectedWorkspaceId,
    setActiveSessionConfigOption,
    setWorkspaceArrivalEvent,
    showToast,
  ]);

  return {
    handleLaunchSelect,
  };
}
