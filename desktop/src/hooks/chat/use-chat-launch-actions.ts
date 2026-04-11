import { useCallback } from "react";
import type { ModelSelectorSelection } from "@/lib/domain/chat/model-selection";
import { useSessionActions } from "@/hooks/sessions/use-session-actions";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useToastStore } from "@/stores/toast/toast-store";
import { useActiveChatSessionState } from "./use-active-chat-session-state";
import {
  failLatencyFlow,
  startLatencyFlow,
} from "@/lib/infra/latency-flow";

export function useChatLaunchActions() {
  const showToast = useToastStore((store) => store.show);
  const setWorkspaceArrivalEvent = useHarnessStore((state) => state.setWorkspaceArrivalEvent);
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const { openWorkspaceSessionWithResolvedConfig, setActiveSessionConfigOption } = useSessionActions();
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
    currentModelConfigId,
    openWorkspaceSessionWithResolvedConfig,
    selectedWorkspaceId,
    setActiveSessionConfigOption,
    setWorkspaceArrivalEvent,
    showToast,
  ]);

  return {
    handleLaunchSelect,
  };
}
